import type { FastifyPluginAsync } from 'fastify';
import { ChatRequestSchema } from '@workexpert/contracts';
import { streamAgentReply } from '@workexpert/agent-core';
import { authorizeRunKnowledge } from '../knowledge/access.js';
import { sendKnowledgeAccessError } from '../knowledge/ownership-routes.js';
import { authorizeRunMcp } from '../orchestration/context-assembler.js';
import { getOrchestrator } from '../orchestration/routes.js';

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.post('/chat', async (request, reply) => {
    const parsed = ChatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid chat request.', issues: parsed.error.issues });
    }
    if (parsed.data.messages.some((message) => message.attachments?.length)) {
      return reply.code(400).send({ message: 'VISION_SESSION_REQUIRED：图片仅支持有权限校验的会话接口。' });
    }
    try { parsed.data = authorizeRunKnowledge(parsed.data, request.auth ?? {}); }
    catch (error) { return sendKnowledgeAccessError(reply, error); }
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });

    const abort = new AbortController();
    /**
     * Listen on the *response* socket. `request.raw` emits `close` as soon as
     * the POST body is fully consumed, which would falsely abort every run.
     */
    const onClientGone = () => {
      if (!abort.signal.aborted) abort.abort();
    };
    reply.raw.on('close', onClientGone);

    try {
      const authorized = await authorizeRunMcp(getOrchestrator().store, parsed.data, request.auth?.userId);
      for await (const event of streamAgentReply({ ...authorized, abortSignal: abort.signal })) {
        if (abort.signal.aborted || reply.raw.writableEnded || reply.raw.destroyed) break;
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      if (!abort.signal.aborted && !reply.raw.writableEnded && !reply.raw.destroyed) {
        const message = error instanceof Error ? error.message : 'Model request failed.';
        reply.raw.write(`data: ${JSON.stringify({ type: 'run.failed', runId: 'unknown', message })}\n\n`);
      }
    } finally {
      reply.raw.off('close', onClientGone);
      if (!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.end();
    }
  });
};

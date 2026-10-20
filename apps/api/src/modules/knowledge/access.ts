import type { FastifyInstance } from 'fastify';
import type { ChatRequest } from '@workexpert/contracts';
import { KnowledgeCatalog, knowledgeDataRoot, KnowledgeAccessError } from './catalog.js';
import { sendKnowledgeAccessError } from './ownership-routes.js';

export function authorizeRunKnowledge(request: ChatRequest, principal: { orgId?: string; userId?: string }, root = knowledgeDataRoot()): ChatRequest {
  if (!request.knowledgeBases?.length) return request;
  if (!principal.orgId || !principal.userId) throw new KnowledgeAccessError(404, 'KNOWLEDGE_NOT_FOUND');
  const catalog = new KnowledgeCatalog(root);
  const actor = { orgId: principal.orgId, userId: principal.userId };
  return { ...request, knowledgeBases: request.knowledgeBases.map((kb) => catalog.resolve(actor, kb.id)) };
}

/** Register inside the knowledge plugin; all existing knowledgeBase-body endpoints share this gate. */
export function registerKnowledgeAccessGuard(app: FastifyInstance, root = knowledgeDataRoot) {
  app.addHook('preHandler', async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || !('knowledgeBase' in body)) return;
    if (!request.auth) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    const supplied = body.knowledgeBase;
    try {
      const id = supplied && typeof supplied === 'object' && 'id' in supplied ? supplied.id : undefined;
      body.knowledgeBase = new KnowledgeCatalog(root()).resolve(request.auth, id);
    } catch (error) { return sendKnowledgeAccessError(reply, error); }
  });
}

import type { FastifyInstance, FastifyReply } from 'fastify';
import { KnowledgeAssignSchema, KnowledgeAssignParamsSchema } from '@workexpert/contracts';
import { localUserAuthService } from '../auth/service.js';
import { KnowledgeAccessError, KnowledgeCatalog, knowledgeDataRoot } from './catalog.js';

export function sendKnowledgeAccessError(reply: FastifyReply, error: unknown) {
  const known = error instanceof KnowledgeAccessError;
  return reply.code(known ? error.statusCode : 503).send({ code: known ? error.code : 'KNOWLEDGE_CATALOG_UNAVAILABLE',
    message: known && error.statusCode === 404 ? '知识库不存在或不可访问。' : '知识库配置操作未完成，请检查权限或刷新后重试。' });
}
export function registerKnowledgeOwnershipRoutes(app: FastifyInstance, dependencies: {
  dataRoot?: () => string;
  users?: () => Array<{ id: string; orgId: string; disabled?: boolean }>;
} = {}) {
  const catalog = () => new KnowledgeCatalog((dependencies.dataRoot ?? knowledgeDataRoot)());
  app.get('/settings/knowledge/bases', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!request.auth) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    try { return catalog().list(request.auth); } catch (error) { return sendKnowledgeAccessError(reply, error); }
  });
  app.put('/settings/knowledge/bases', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!request.auth) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    try { return catalog().save(request.auth, request.body); } catch (error) { return sendKnowledgeAccessError(reply, error); }
  });
  app.get('/settings/knowledge/unassigned', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!request.auth) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    try { return { items: catalog().unassigned(request.auth) }; } catch (error) { return sendKnowledgeAccessError(reply, error); }
  });
  app.post('/settings/knowledge/bases/:knowledgeBaseId/assign', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!request.auth) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    if (request.auth.role !== 'admin') return reply.code(403).send({ code: 'ADMIN_REQUIRED' });
    const body = KnowledgeAssignSchema.safeParse(request.body), params = KnowledgeAssignParamsSchema.safeParse(request.params);
    if (!body.success || !params.success) return reply.code(400).send({ code: 'INVALID_INPUT' });
    try {
      const target = (dependencies.users ?? (() => localUserAuthService().listUsers()))()
        .find((user) => user.id === body.data.ownerUserId);
      if (!target) throw new KnowledgeAccessError(404, 'KNOWLEDGE_NOT_FOUND');
      return { ownership: catalog().assign(request.auth, params.data.knowledgeBaseId, target) };
    } catch (error) { return sendKnowledgeAccessError(reply, error); }
  });
}

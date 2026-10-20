import type { FastifyInstance, FastifyRequest } from 'fastify';
import { OntologyAnalysisJobRequestSchema, OntologyAnalysisSkipRequestSchema } from '@workexpert/contracts';

type ControlledJob = {
  knowledgeBaseId?: string;
  status: string;
  phase: string;
  stopRequested?: boolean;
  control?: { skip(batchNumber: number): boolean; stop(): void };
};

export function registerOntologyAnalysisControls<T extends ControlledJob>(app: FastifyInstance, dependencies: {
  findJob(id: string): T | undefined;
  canAccess(request: FastifyRequest, knowledgeBaseId: string): boolean;
  publicJob(job: T): unknown;
  persist(): void;
}) {
  for (const action of ['skip', 'stop'] as const) app.post(`/knowledge/ontology/analysis/${action}`, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ message: 'Authentication required.' });
    const parsed = OntologyAnalysisSkipRequestSchema.safeParse(request.body);
    const jobRequest = OntologyAnalysisJobRequestSchema.safeParse(request.body);
    if (!jobRequest.success || (action === 'skip' && !parsed.success)) return reply.code(400).send({ message: 'Invalid analysis control request.' });
    const job = dependencies.findJob(jobRequest.data.jobId);
    if (!job?.knowledgeBaseId || !dependencies.canAccess(request, job.knowledgeBaseId)) return reply.code(404).send({ message: '分析任务不存在或不可访问。' });
    if (action === 'skip') {
      if (!parsed.success || job.status !== 'running' || !job.control?.skip(parsed.data.batchNumber)) return reply.code(409).send({ message: '该批次已结束或正在停止，请查看最新进度。' });
      return { ok: true };
    }
    if (job.status === 'running' && !job.stopRequested) {
      if (!job.control) return reply.code(409).send({ message: '当前任务暂时无法控制，请刷新后查看进度。' });
      job.stopRequested = true;
      job.phase = '正在停止并保存结果';
      job.control.stop();
      dependencies.persist();
    }
    return { ok: true, job: dependencies.publicJob(job) };
  });
}

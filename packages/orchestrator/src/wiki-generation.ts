import { randomUUID } from 'node:crypto';
import type { WikiGenerationJob, WikiScope, WikiGeneratedPage } from '@workexpert/contracts';
import { wikiGenerationFailureCode } from '@workexpert/contracts';
import type { ExecutionDispatcher } from './execution-dispatcher.js';
import { withKeyLock } from './lock.js';

export interface WikiJobRepository {
  get(id: string, byKey?: boolean): WikiGenerationJob | undefined;
  list(): WikiGenerationJob[];
  save(job: WikiGenerationJob): void;
}
export class WikiGenerationError extends Error {
  constructor(public readonly code: 'CAPACITY_EXCEEDED' | 'IDEMPOTENCY_CONFLICT') { super(code); }
}
const active = (job: WikiGenerationJob) => job.state === 'queued' || job.state === 'running';

/** State transitions belong here; the API supplies SQLite/source/model adapters. */
export class WikiGenerationService {
  private readonly running = new Map<string, AbortController>();
  private readonly pending = new Set<Promise<void>>();
  constructor(private readonly dispatcher: ExecutionDispatcher) {}

  read(repository: WikiJobRepository, id: string): WikiGenerationJob | undefined {
    const job = repository.get(id);
    if (job && active(job) && !this.running.has(job.jobId)) {
      job.state = 'interrupted'; job.errorCode = 'PROCESS_INTERRUPTED'; job.updatedAt = new Date().toISOString();
      repository.save(job);
    }
    return job;
  }

  async start(input: {
    scope: WikiScope; idempotencyKey: string; requestHash: string;
    sources: WikiGenerationJob['sources']; totalChunks: number; repository: WikiJobRepository;
    batchChunks?: number[];
    generate: (signal: AbortSignal, batchIndex: number) => Promise<WikiGeneratedPage[]>;
    merge?: (batches: WikiGeneratedPage[][]) => WikiGeneratedPage[];
    savePage: (page: WikiGeneratedPage, jobId: string, linkPhase: boolean) => void;
  }): Promise<WikiGenerationJob> {
    const batchChunks = input.batchChunks ?? [input.totalChunks];
    if (!batchChunks.length || batchChunks.length > 8 || batchChunks.some((n) => !Number.isInteger(n) || n < 1 || n > 100)
      || batchChunks.reduce((a, b) => a + b, 0) !== input.totalChunks || (batchChunks.length > 1 && !input.merge)) {
      throw new Error('INVALID_BATCH_PLAN');
    }
    return withKeyLock(`wiki:${JSON.stringify(input.scope)}`, () => {
      const prior = input.repository.get(input.idempotencyKey, true);
      if (prior) {
        if (prior.requestHash !== input.requestHash) throw new WikiGenerationError('IDEMPOTENCY_CONFLICT');
        return this.read(input.repository, prior.jobId)!;
      }
      for (const stored of input.repository.list()) {
        const job = this.read(input.repository, stored.jobId)!;
        if (active(job)) throw new WikiGenerationError('CAPACITY_EXCEEDED');
      }
      const now = new Date().toISOString();
      const job: WikiGenerationJob = { schemaVersion: 1, jobId: `wj-${randomUUID()}`, scope: input.scope,
        idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, state: 'queued',
        sources: input.sources, totalChunks: input.totalChunks, processedChunks: 0, pageIds: [], errorCode: null,
        createdAt: now, updatedAt: now };
      input.repository.save(job);
      const controller = new AbortController(); this.running.set(job.jobId, controller);
      const checkpoint = () => { job.updatedAt = new Date().toISOString(); input.repository.save(job); };
      const work = this.dispatcher.dispatch({ runId: job.jobId, orgId: job.scope.orgId, userId: job.scope.userId,
        sessionId: `wiki:${job.scope.knowledgeBaseId}`, kind: 'project-task', priority: 'normal', signal: controller.signal,
        execute: async () => {
          controller.signal.throwIfAborted(); job.state = 'running'; checkpoint();
          const batches: WikiGeneratedPage[][] = [];
          for (let index = 0; index < batchChunks.length; index++) {
            controller.signal.throwIfAborted();
            batches.push(await input.generate(controller.signal, index));
            controller.signal.throwIfAborted();
            job.processedChunks += batchChunks[index]; checkpoint();
          }
          const pages = input.merge ? input.merge(batches) : batches[0];
          controller.signal.throwIfAborted();
          job.processedChunks = job.totalChunks;
          for (const page of pages) {
            controller.signal.throwIfAborted();
            input.savePage({ ...page, content: { ...page.content, links: [] } }, job.jobId, false);
            job.pageIds.push(page.pageId); checkpoint();
          }
          for (const page of pages.filter((p) => p.content.links.length)) {
            controller.signal.throwIfAborted(); input.savePage(page, job.jobId, true); checkpoint();
          }
          job.state = 'completed'; checkpoint();
        },
      }).catch((error: unknown) => {
        job.state = controller.signal.aborted ? 'cancelled' : job.pageIds.length ? 'partial' : 'failed';
        job.errorCode = controller.signal.aborted ? 'CANCELLED' : wikiGenerationFailureCode(error) ?? 'GENERATION_FAILED'; checkpoint();
      }).finally(() => { this.running.delete(job.jobId); });
      // Persisting a failure can itself fail. Never create an unhandled rejection or falsely report success.
      const settled = work.catch(() => undefined).finally(() => { this.pending.delete(settled); });
      this.pending.add(settled);
      return structuredClone(job);
    });
  }

  cancel(repository: WikiJobRepository, id: string): WikiGenerationJob | undefined {
    const job = this.read(repository, id);
    if (job && active(job)) this.running.get(id)?.abort();
    return job; // State changes only after the in-flight work actually stops.
  }

  async close(): Promise<void> {
    for (const controller of this.running.values()) controller.abort();
    await Promise.all(this.pending);
  }
}

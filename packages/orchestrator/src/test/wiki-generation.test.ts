import test from 'node:test';
import assert from 'node:assert/strict';
import type { WikiGenerationJob, WikiGeneratedPage } from '@workexpert/contracts';
import { WikiGenerationService, type WikiJobRepository } from '../wiki-generation.js';
import { InMemoryExecutionDispatcher } from '../execution-dispatcher.js';
import { WikiGenerationJobSchema, WikiGenerationFailure, WikiGenerationFailureCodeSchema } from '@workexpert/contracts';

const scope = { orgId: 'o', userId: 'u', knowledgeBaseId: 'kb' };
test('WK-G02c: typed failure whitelist survives, provider messages and forged codes do not', async () => {
  const failures: unknown[] = WikiGenerationFailureCodeSchema.options.map((code) => new WikiGenerationFailure(code));
  failures.push(new Error('api-key-secret'), { code: 'MODEL_TIMEOUT', message: 'private prompt' });
  for (const failure of failures) {
    const f = fixture();
    const job = await f.service.start({ ...f.base, generate: async () => { throw failure; }, savePage: () => assert.fail() });
    const done = await finish(f, job.jobId);
    assert.equal(done.state, 'failed');
    assert.equal(done.errorCode, failure instanceof WikiGenerationFailure ? failure.code : 'GENERATION_FAILED');
    assert.equal(JSON.stringify(done).includes('secret'), false); assert.equal(JSON.stringify(done).includes('private prompt'), false);
    await f.service.close();
  }
});
test('WK-G02c: explicit cancellation takes priority over a provider failure', async () => {
  const f = fixture();
  const job = await f.service.start({ ...f.base, generate: async () => {
    f.service.cancel(f.repository, f.repository.list()[0].jobId);
    throw new WikiGenerationFailure('MODEL_UNAVAILABLE');
  }, savePage: () => assert.fail() });
  const done = await finish(f, job.jobId);
  assert.equal(done.state, 'cancelled'); assert.equal(done.errorCode, 'CANCELLED'); await f.service.close();
});
function fixture() {
  const rows = new Map<string, WikiGenerationJob>();
  const repository: WikiJobRepository = {
    get: (id, byKey) => structuredClone(byKey ? [...rows.values()].find((j) => j.idempotencyKey === id) : rows.get(id)),
    list: () => structuredClone([...rows.values()]), save: (job) => { rows.set(job.jobId, structuredClone(job)); },
  };
  const service = new WikiGenerationService(new InMemoryExecutionDispatcher());
  const base = { scope, idempotencyKey: 'one', requestHash: 'a'.repeat(64), repository,
    sources: [{ documentId: 'd', documentVersionId: 'v', processingRevisionId: 'r' }], totalChunks: 2 };
  return { rows, repository, service, base };
}
const pages: WikiGeneratedPage[] = ['p1', 'p2'].map((pageId) => ({ pageId, slug: pageId, content: {
  title: pageId, summary: '', aliases: [], categoryPath: [], bodyMarkdown: 'body',
  sections: [{ sectionId: 's', headingPath: ['Title'], start: 0, end: 4 }], links: [],
  evidenceRefs: [{ refId: 'ref', sectionId: 's', sourceKind: 'local-evidence', excerptHash: 'a'.repeat(64),
    evidence: { schemaVersion: 1, verification: 'versioned', provider: 'lancedb', knowledgeBaseId: 'kb', documentId: 'd',
      documentVersionId: 'v', processingRevisionId: 'r', chunkId: 'c', contentHash: 'a'.repeat(64) } }],
} }));
async function finish(f: ReturnType<typeof fixture>, id: string) {
  for (let i = 0; i < 100; i++) {
    const result = f.service.read(f.repository, id)!;
    if (!['running', 'queued'].includes(result.state)) return result;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('timeout');
}
test('WK-G02b: sequential batches checkpoint validated chunks before saving; replay never reruns', async () => {
  const f = fixture(); const indices: number[] = []; let merged = false;
  const args = { ...f.base, batchChunks: [1, 1],
    generate: async (_signal: AbortSignal, index: number) => {
      assert.equal(f.repository.list()[0].processedChunks, index);
      indices.push(index); return [pages[index]];
    },
    merge: (batches: WikiGeneratedPage[][]) => { merged = true; return batches.flat(); },
    savePage: () => { assert.equal(merged, true); assert.equal(f.repository.list()[0].processedChunks, 2); },
  };
  const job = await f.service.start(args); const done = await finish(f, job.jobId);
  assert.equal(done.state, 'completed'); assert.deepEqual(indices, [0, 1]);
  assert.equal(WikiGenerationJobSchema.safeParse(done).success, true);
  assert.equal(WikiGenerationJobSchema.safeParse({ ...done, totalChunks: 400, processedChunks: 400,
    pageIds: Array.from({ length: 64 }, (_, n) => `p-${n}`) }).success, true);
  await f.service.start(args); assert.deepEqual(indices, [0, 1]); await f.service.close();
});
test('WK-G02b: second batch failure or cancellation stops later calls and does not save incomplete candidates', async () => {
  for (const cancel of [false, true]) {
    const f = fixture(); const indices: number[] = [];
    const job = await f.service.start({ ...f.base, totalChunks: 3, batchChunks: [1, 1, 1],
      generate: async (_signal, index) => {
        indices.push(index);
        if (index === 1) {
          if (cancel) f.service.cancel(f.repository, f.repository.list()[0].jobId);
          else throw new Error('failed batch');
        }
        return pages;
      }, merge: (batches) => batches.flat(), savePage: () => assert.fail('must not save incomplete candidates'),
    });
    const done = await finish(f, job.jobId);
    assert.equal(done.state, cancel ? 'cancelled' : 'failed'); assert.equal(done.processedChunks, 1);
    assert.deepEqual(indices, [0, 1]); assert.deepEqual(done.pageIds, []); await f.service.close();
  }
});
test('WK-G02a: idempotency, partial commits retained, sanitized errors and no automatic retry', async () => {
  const f = fixture(); let calls = 0;
  const args = { ...f.base, generate: async () => { calls++; return pages; },
    savePage: (page: WikiGeneratedPage) => { if (page.pageId === 'p2') throw new Error('provider secret must not persist'); } };
  const first = await f.service.start(args);
  const result = await finish(f, first.jobId);
  assert.equal(result.state, 'partial'); assert.deepEqual(result.pageIds, ['p1']);
  assert.equal(result.errorCode, 'GENERATION_FAILED'); assert.equal(JSON.stringify(result).includes('provider secret'), false);
  assert.equal((await f.service.start(args)).jobId, first.jobId); assert.equal(calls, 1);
  await assert.rejects(f.service.start({ ...args, requestHash: 'b'.repeat(64) }), /IDEMPOTENCY_CONFLICT/);
  await f.service.close();
});
test('WK-G02a: interrupted persisted jobs do not restart a model', async () => {
  const f = fixture();
  const now = new Date().toISOString();
  f.repository.save({ schemaVersion: 1, jobId: 'old', scope, state: 'running', idempotencyKey: 'old-key', requestHash: 'a'.repeat(64),
    sources: f.base.sources, totalChunks: 2, processedChunks: 2, pageIds: ['saved'], errorCode: null, createdAt: now, updatedAt: now });
  const restored = f.service.read(f.repository, 'old')!;
  assert.equal(restored.state, 'interrupted'); assert.deepEqual(restored.pageIds, ['saved']);
  assert.equal(f.repository.get('old')!.errorCode, 'PROCESS_INTERRUPTED'); await f.service.close();
});
test('WK-G02a: active library rejects a second request, cancellation waits for generator acknowledgement', async () => {
  const f = fixture(); let release!: () => void;
  const result = await f.service.start({ ...f.base,
    generate: async () => { await new Promise<void>((resolve) => { release = resolve; }); return pages; },
    savePage: () => assert.fail('cancelled generation must not save'),
  });
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  await assert.rejects(f.service.start({ ...f.base, idempotencyKey: 'two', generate: async () => pages, savePage: () => {} }), /CAPACITY_EXCEEDED/);
  assert.equal(f.service.cancel(f.repository, result.jobId)!.state, 'running');
  release(); assert.equal((await finish(f, result.jobId)).state, 'cancelled');
  await f.service.close();
});

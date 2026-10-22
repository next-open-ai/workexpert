import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { KnowledgeEvidenceStore, KnowledgeSourceStore, ImmutableFileStore } from '@workexpert/storage';
import type { WikiContent, KnowledgeEvidenceBatch } from '@workexpert/contracts';
import { WikiGenerationFailure } from '@workexpert/contracts';
import { registerWikiRoutes } from './wiki-routes.js';
import { registerWikiGenerationRoutes } from './wiki-generation-routes.js';
import { InMemoryExecutionDispatcher } from '@workexpert/orchestrator';
import { validateWikiGeneration, type generateWikiPages } from '@workexpert/agent-core';

function fixture(t: TestContext, enable = true, generate?: typeof generateWikiPages, chunkCount = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workexpert-wiki-api-'));
  const directory = path.join(root, 'kb'); fs.mkdirSync(directory);
  const config = [{ id: 'kb', name: 'Knowledge', provider: 'lancedb', enabled: true, dataDir: directory,
    ownership: { schemaVersion: 1, orgId: 'org', ownerUserId: 'alice', assignedBy: 'admin', assignedAt: new Date().toISOString() } }];
  fs.writeFileSync(path.join(root, 'knowledge-bases.json'), JSON.stringify({ meta: config }));
  const owner = { orgId: 'org', userId: 'alice' };
  const source = { provider: 'lancedb', knowledgeBaseId: 'kb', documentId: 'doc' };
  const chunkText = '差旅报销需要发票';
  const bytes = Buffer.from(Array.from({ length: chunkCount }, () => chunkText).join('\n'));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const sourceRoot = path.join(root, 'knowledge-sources');
  const files = new ImmutableFileStore(path.join(sourceRoot, 'objects'));
  const sources = new KnowledgeSourceStore(path.join(sourceRoot, 'sources.sqlite'), files);
  sources.put(owner, { ...source, documentVersionId: 'v1', file: files.put(owner, bytes), fileName: 'source.txt', origin: 'text', status: 'archived' });
  sources.close();
  const database = path.join(directory, 'knowledge-evidence.sqlite');
  const evidence = new KnowledgeEvidenceStore(database);
  const batch: KnowledgeEvidenceBatch = { ...source, documentVersionId: 'v1', processingRevisionId: 'r1', sourceHash: hash,
    chunks: Array.from({ length: chunkCount }, (_, n) => ({ content: chunkText, evidence: { ...source, schemaVersion: 1, verification: 'versioned',
      documentVersionId: 'v1', processingRevisionId: 'r1', chunkId: n ? `chunk-${n}` : 'chunk',
      contentHash: createHash('sha256').update(chunkText).digest('hex') } })) };
  evidence.putBatch(batch); evidence.activate(source, 'r1', 0);
  const content: WikiContent = { title: '差旅报销', aliases: ['出差费用'], summary: '发票说明', categoryPath: [],
    bodyMarkdown: '需要发票', sections: [{ sectionId: 's', headingPath: ['报销'], start: 0, end: 4 }],
    evidenceRefs: [{ refId: 'ref', sectionId: 's', sourceKind: 'local-evidence', evidence: batch.chunks[0].evidence, excerptHash: hash }], links: [] };
  if (enable) {
    const wiki = evidence.openWiki({ ...owner, knowledgeBaseId: 'kb' }, () => true);
    wiki.saveDraft({ pageId: 'page', slug: 'page', content, authorType: 'model', baseGeneration: 0, idempotencyKey: 'seed' });
  }
  evidence.close();
  const app = Fastify();
  // Test-only authentication adapter; production inherits the session authGuard.
  app.addHook('preHandler', async (request) => {
    const user = request.headers['x-user'];
    if (typeof user === 'string') request.auth = { userId: user, orgId: String(request.headers['x-org'] || 'org'),
      username: user, displayName: user, role: user === 'admin' ? 'admin' : 'member', sessionId: 'test' };
  });
  registerWikiRoutes(app, { dataRoot: () => root });
  let modelCalls = 0;
  registerWikiGenerationRoutes(app, { dataRoot: () => root, dispatcher: () => new InMemoryExecutionDispatcher(),
    generate: async (...args) => {
      modelCalls += 1;
      if (generate) return generate(...args);
      return validateWikiGeneration({ pages: [1, 2].map((n) => ({ key: `p${n}`, title: n === 1 ? '差旅报销' : '发票规则',
        aliases: n === 1 ? ['出差费用'] : [], summary: '需要发票', sections: [{ heading: '要求', body: '差旅报销需要发票',
          chunkIds: ['chunk'], relatedKeys: [`p${3 - n}`] }] })) }, args[0]);
    } });
  t.after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const get = (suffix: string, user = 'alice', org = 'org') => app.inject({ method: 'GET', url: '/knowledge/kb/wiki' + suffix,
    headers: { 'x-user': user, 'x-org': org } });
  const publish = async () => {
    const view = (await get('/pages/page?view=drafts')).json();
    const payload = { baseGeneration: view.page.generation, draftRevisionId: view.revision.revisionId,
      contentHash: view.revision.contentHash, idempotencyKey: 'publish' };
    const result = await app.inject({ method: 'POST', url: '/knowledge/kb/wiki/pages/page/publish', headers: { 'x-user': 'alice' }, payload });
    assert.equal(result.statusCode, 200, result.body);
    return { payload, result };
  };
  return { app, get, publish, root, database, sourceRoot, content, config, modelCalls: () => modelCalls };
}

const generationBody = { documentIds: ['doc'], idempotencyKey: 'generate-one',
  model: { provider: 'openai-compatible', chatModel: 'test-model', apiKey: 'never-persist-this-secret' } };
test('WK-M19-T: authorized merge preview and CAS save keep publication and source draft intact', async (t) => {
  const f = fixture(t); await f.publish();
  const store = new KnowledgeEvidenceStore(f.database);
  try {
    const content = structuredClone(f.content); content.title = '出差费用'; content.bodyMarkdown = '新增流程😀'; content.sections[0].end = content.bodyMarkdown.length;
    store.openExistingWiki({ orgId: 'org', userId: 'alice', knowledgeBaseId: 'kb' }, () => true)!.saveDraft({
      pageId: 'new-source', slug: 'new-source', content, authorType: 'model', baseGeneration: 0, idempotencyKey: 'new-source' });
  } finally { store.close(); }
  assert.equal((await f.get('/pages/new-source/merge-candidates', 'bob')).statusCode, 404);
  assert.deepEqual((await f.get('/pages/new-source/merge-candidates')).json().items, [{ pageId: 'page', title: '差旅报销' }]);
  const previewResponse = await f.get('/pages/new-source/merge-preview?targetPageId=page');
  assert.equal(previewResponse.statusCode, 200, previewResponse.body);
  const { content, targetBody, addedSections, skippedSections, ...request } = previewResponse.json();
  assert.equal(addedSections, 1); assert.equal(content.bodyMarkdown, '需要发票\n\n新增流程😀');
  const send = (payload: object) => f.app.inject({ method: 'POST', url: '/knowledge/kb/wiki/pages/new-source/merge', headers: { 'x-user': 'alice' }, payload });
  assert.equal((await send({ ...request, previewHash: '0'.repeat(64), idempotencyKey: 'wrong' })).statusCode, 409);
  assert.equal((await send({ ...request, content, idempotencyKey: 'inject' })).statusCode, 400);
  const first = await send({ ...request, idempotencyKey: 'merge' }); assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual((await send({ ...request, idempotencyKey: 'merge' })).json(), first.json());
  assert.equal((await f.get('/pages/page')).json().revision.content.bodyMarkdown, targetBody);
  assert.equal((await f.get('/pages/page?view=drafts')).json().revision.content.bodyMarkdown, content.bodyMarkdown);
  assert.equal((await f.get('/pages/new-source?view=drafts')).statusCode, 200);
  assert.equal((await send({ ...request, idempotencyKey: 'stale-preview' })).statusCode, 409);
  assert.equal(f.modelCalls(), 0);
});
test('WK-R18-T: real SQLite resume reuses first batch and exposes metadata only', async (t) => {
  let count = 0; const sizes: number[] = [];
  const f = fixture(t, false, async (input) => {
    const chunkIds = input.batches.flatMap((b) => b.chunks.map((c) => c.evidence.chunkId)); sizes.push(chunkIds.length);
    if (++count === 2) throw new WikiGenerationFailure('MODEL_TIMEOUT');
    return validateWikiGeneration({ pages: [{ key: 'p', title: '续跑主题', aliases: [], summary: '私有候选',
      sections: [{ heading: '要求', body: '核对发票', chunkIds, relatedKeys: [] }] }] }, input);
  }, 101);
  const send = (payload: object, user = 'alice') => f.app.inject({ method: 'POST', url: '/knowledge/kb/wiki/generation-jobs', headers: { 'x-user': user }, payload });
  const first = await send(generationBody); assert.equal(first.statusCode, 202, first.body);
  const failed = await terminal(f, first.json().jobId);
  assert.equal(failed.processedChunks, 100); assert.equal(failed.resumable, true);
  const list = await f.get('/generation-jobs');
  assert.equal(list.body.includes('私有候选'), false); assert.equal(list.body.includes('_checkpoint'), false);
  const resume = { ...generationBody, resumeJobId: failed.jobId, idempotencyKey: 'resume-1' };
  assert.equal((await send(resume, 'bob')).statusCode, 404);
  const changed = await send({ ...resume, model: { ...generationBody.model, chatModel: 'different' } });
  assert.equal(changed.statusCode, 409); assert.equal(changed.json().code, 'MODEL_CHANGED');
  const next = await send(resume); assert.equal(next.statusCode, 202, next.body);
  const done = await terminal(f, failed.jobId);
  assert.equal(done.state, 'completed'); assert.deepEqual(sizes, [100, 1, 1]); assert.equal(done.pageIds.length, 1);
  assert.equal((await send(resume)).json().jobId, done.jobId); assert.equal(count, 3);
  const store = new KnowledgeEvidenceStore(f.database);
  try { assert.equal(store.wikiCheckpoint({ orgId: 'org', userId: 'alice', knowledgeBaseId: 'kb' }, done.jobId)!.batches.length, 0); }
  finally { store.close(); }
});
test('WK-R18-T: source deletion prevents resume before another model call', async (t) => {
  const f = fixture(t, false, async () => { throw new WikiGenerationFailure('MODEL_TIMEOUT'); });
  const send = (payload: object) => f.app.inject({ method: 'POST', url: '/knowledge/kb/wiki/generation-jobs', headers: { 'x-user': 'alice' }, payload });
  const first = await send(generationBody); const failed = await terminal(f, first.json().jobId);
  const store = new KnowledgeEvidenceStore(f.database);
  try { store.suppressChunks(['chunk']); } finally { store.close(); }
  const resumed = await send({ ...generationBody, resumeJobId: failed.jobId, idempotencyKey: 'resume-deleted' });
  assert.equal(resumed.statusCode, 422); assert.equal(f.modelCalls(), 1);
});
test('WK-A07: failure reason persists without raw model content and replay never calls provider again', async (t) => {
  const f = fixture(t, false, async () => { throw new WikiGenerationFailure('MODEL_OUTPUT_TRUNCATED'); });
  const start = () => f.app.inject({ method: 'POST', url: '/knowledge/kb/wiki/generation-jobs', headers: { 'x-user': 'alice' }, payload: generationBody });
  const response = await start(); assert.equal(response.statusCode, 202);
  const job = await terminal(f, response.json().jobId);
  assert.equal(job.errorCode, 'MODEL_OUTPUT_TRUNCATED'); assert.equal(job.state, 'failed'); assert.deepEqual(job.pageIds, []);
  assert.equal((await start()).json().jobId, job.jobId); assert.equal(f.modelCalls(), 1);
});
test('WK-A06: 101 source blocks generate sequentially, collect same-title sections and publish/search real drafts', async (t) => {
  const sizes: number[] = [];
  const f = fixture(t, false, async (input) => {
    const chunkIds = input.batches.flatMap((b) => b.chunks.map((c) => c.evidence.chunkId)); sizes.push(chunkIds.length);
    return validateWikiGeneration({ pages: [{ key: 'topic', title: '长文报销', aliases: ['长文别名'], summary: '发票核对',
      sections: [{ heading: '分批要求', body: `第${sizes.length}批😀需要发票`, chunkIds, relatedKeys: [] }] }] }, input);
  }, 101);
  const response = await f.app.inject({ method: 'POST', url: '/knowledge/kb/wiki/generation-jobs', headers: { 'x-user': 'alice' }, payload: generationBody });
  assert.equal(response.statusCode, 202, response.body);
  const job = await terminal(f, response.json().jobId);
  assert.equal(job.state, 'completed'); assert.equal(job.processedChunks, 101); assert.deepEqual(sizes, [100, 1]);
  assert.equal(job.pageIds.length, 1);
  const view = (await f.get(`/pages/${job.pageIds[0]}?view=drafts`)).json();
  assert.equal(view.revision.content.sections.length, 2); assert.equal(view.revision.content.evidenceRefs.length, 101);
  assert.equal((await f.get('/search?query=长文别名')).json().items.length, 0);
  const published = await f.app.inject({ method: 'POST', url: `/knowledge/kb/wiki/pages/${job.pageIds[0]}/publish`, headers: { 'x-user': 'alice' },
    payload: { baseGeneration: view.page.generation, draftRevisionId: view.revision.revisionId, contentHash: view.revision.contentHash, idempotencyKey: 'publish-long' } });
  assert.equal(published.statusCode, 200, published.body);
  assert.equal((await f.get('/search?query=长文别名')).json().items.length, 1);
});
async function terminal(f: ReturnType<typeof fixture>, id: string) {
  for (let i = 0; i < 100; i++) {
    const response = await f.get(`/generation-jobs/${id}`);
    assert.equal(response.statusCode, 200, response.body);
    const job = response.json();
    if (!['queued', 'running'].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Job did not finish');
}
test('WK-A04: v4 source → real generated drafts → publish → BM25 → links → original evidence; idempotent and backed up', async (t) => {
  const f = fixture(t, false);
  const start = () => f.app.inject({ method: 'POST', url: '/knowledge/kb/wiki/generation-jobs', headers: { 'x-user': 'alice' }, payload: generationBody });
  const response = await start(); assert.equal(response.statusCode, 202, response.body);
  const job = await terminal(f, response.json().jobId);
  assert.equal(job.state, 'completed'); assert.equal(job.pageIds.length, 2); assert.equal(job.processedChunks, 1);
  assert.equal((await start()).json().jobId, job.jobId); assert.equal(f.modelCalls(), 1);
  assert.equal((await f.get(`/generation-jobs/${job.jobId}`, 'bob')).statusCode, 404);
  assert.deepEqual((await f.get('/search?query=发票')).json().items, []);
  const draftList = (await f.get('/pages?view=drafts')).json(); assert.equal(draftList.items.length, 2);
  for (const id of job.pageIds) {
    const view = (await f.get(`/pages/${id}?view=drafts`)).json();
    assert.equal(view.revision.authorType, 'model'); assert.equal(view.revision.content.links.length, 1);
    const original = (await f.get(`/pages/${id}/sources?revisionId=${view.revision.revisionId}`)).json();
    assert.equal(original.items[0].text, '差旅报销需要发票');
    const result = await f.app.inject({ method: 'POST', url: `/knowledge/kb/wiki/pages/${id}/publish`, headers: { 'x-user': 'alice' },
      payload: { baseGeneration: view.page.generation, draftRevisionId: view.revision.revisionId, contentHash: view.revision.contentHash, idempotencyKey: `pub-${id}` } });
    assert.equal(result.statusCode, 200, result.body);
  }
  const hits = (await f.get('/search?query=发票')).json().items;
  assert.equal(hits.length, 2); assert.equal(typeof hits[0].bm25, 'number');
  assert.ok((await f.get(`/pages/${job.pageIds[0]}/related`)).json().items.some((p: { pageId: string }) => p.pageId === job.pageIds[1]));
  const backups = fs.readdirSync(path.dirname(f.database)).filter((name) => name.endsWith('.bak'));
  assert.equal(backups.length, 1);
  const backup = new DatabaseSync(path.join(path.dirname(f.database), backups[0]), { readOnly: true });
  assert.equal(backup.prepare('PRAGMA user_version').get()!.user_version, 4);
  assert.equal(backup.prepare('SELECT count(*) AS n FROM batches').get()!.n, 1); backup.close();
  const db = new DatabaseSync(f.database, { readOnly: true });
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 6);
  assert.equal(String(db.prepare('SELECT payload FROM wiki_generation_jobs').get()!.payload).includes('never-persist-this-secret'), false); db.close();
  const evidence = new KnowledgeEvidenceStore(f.database);
  assert.ok(evidence.searchKeywords('发票', 5).length); evidence.suppressChunks(['chunk']); evidence.close();
  assert.equal((await f.get(`/pages/${job.pageIds[0]}/sources`)).statusCode, 404);
  assert.deepEqual((await f.get('/search?query=发票')).json().items, []);
});
test('WK-A04: malformed/foreign/missing sources never call a model; cancellation and capacity are explicit', async (t) => {
  const f = fixture(t, false, async (_input, _model, signal) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new Error('cancelled'));
    else signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  }));
  const send = (payload: unknown, user = 'alice') => f.app.inject({ method: 'POST', url: '/knowledge/kb/wiki/generation-jobs', headers: { 'x-user': user }, payload: payload as object });
  assert.equal((await send({ ...generationBody, documentIds: ['missing'] })).statusCode, 422);
  assert.equal((await send({ ...generationBody, orgId: 'fake' })).statusCode, 400);
  assert.equal((await send(generationBody, 'bob')).statusCode, 404); assert.equal(f.modelCalls(), 0);
  const started = await send(generationBody); assert.equal(started.statusCode, 202, started.body);
  assert.equal((await send({ ...generationBody, idempotencyKey: 'another' })).statusCode, 429);
  assert.equal((await send({ ...generationBody, documentIds: ['different'] })).statusCode, 409);
  const id = started.json().jobId;
  assert.equal((await f.app.inject({ method: 'POST', url: `/knowledge/kb/wiki/generation-jobs/${id}/cancel`, headers: { 'x-user': 'alice' }, payload: {} })).statusCode, 200);
  assert.equal((await terminal(f, id)).state, 'cancelled');
  assert.equal(f.modelCalls(), 1);
  assert.deepEqual((await f.get('/pages?view=drafts')).json().items, []);
});

test('WK-A06: over-limit snapshot is rejected before model invocation', async (t) => {
  const f = fixture(t, false, undefined, 401);
  const response = await f.app.inject({ method: 'POST', url: '/knowledge/kb/wiki/generation-jobs', headers: { 'x-user': 'alice' }, payload: generationBody });
  assert.equal(response.statusCode, 413); assert.equal(f.modelCalls(), 0);
});

test('WK-A06: source suppression between batches prevents the next model call and all draft commits', async (t) => {
  let database = '';
  const f = fixture(t, false, async (input) => {
    const chunkIds = input.batches.flatMap((b) => b.chunks.map((c) => c.evidence.chunkId));
    const pages = validateWikiGeneration({ pages: [{ key: 'p', title: 'Source', aliases: [], summary: '',
      sections: [{ heading: 'Evidence', body: 'Original text', chunkIds, relatedKeys: [] }] }] }, input);
    const store = new KnowledgeEvidenceStore(database);
    try { store.suppressChunks(['chunk']); } finally { store.close(); }
    return pages;
  }, 101);
  database = f.database;
  const response = await f.app.inject({ method: 'POST', url: '/knowledge/kb/wiki/generation-jobs', headers: { 'x-user': 'alice' }, payload: generationBody });
  assert.equal(response.statusCode, 202);
  const job = await terminal(f, response.json().jobId);
  assert.equal(job.state, 'failed'); assert.equal(job.errorCode, 'SOURCE_CHANGED'); assert.equal(f.modelCalls(), 1); assert.deepEqual(job.pageIds, []);
});

test('WK-A04: source suppression during a model call prevents draft commits', async (t) => {
  let database = '';
  const f = fixture(t, false, async (input) => {
    const pages = validateWikiGeneration({ pages: [{ key: 'p', title: 'Old source', aliases: [], summary: '',
      sections: [{ heading: 'Evidence', body: 'Original text', chunkIds: ['chunk'], relatedKeys: [] }] }] }, input);
    const store = new KnowledgeEvidenceStore(database);
    try { store.suppressChunks(['chunk']); } finally { store.close(); }
    return pages;
  });
  database = f.database;
  const start = await f.app.inject({ method: 'POST', url: '/knowledge/kb/wiki/generation-jobs', headers: { 'x-user': 'alice' }, payload: generationBody });
  assert.equal(start.statusCode, 202, start.body);
  const job = await terminal(f, start.json().jobId);
  assert.equal(job.state, 'failed'); assert.deepEqual(job.pageIds, []);
  assert.deepEqual((await f.get('/pages?view=drafts')).json().items, []);
});

test('WK-A02: personal scope, draft isolation, real FTS, historical authorization and administrator denial', async (t) => {
  const f = fixture(t);
  assert.equal((await f.app.inject('/knowledge/kb/wiki/pages')).statusCode, 401);
  assert.deepEqual((await f.get('/search?query=报销')).json().items, []);
  assert.equal((await f.get('/pages/page')).statusCode, 404);
  const { payload } = await f.publish();
  assert.equal((await f.get('/search?query=出差费用')).json().items[0].pageId, 'page');
  const keyword = (await f.get('/search?query=发票')).json().items[0];
  assert.equal(typeof keyword.bm25, 'number');
  assert.equal((await f.get('/pages')).json().items.length, 1);
  for (const [user, org] of [['bob', 'org'], ['admin', 'org'], ['alice', 'other']]) {
    for (const suffix of ['/pages/page', `/pages/page?revisionId=${payload.draftRevisionId}`, '/pages/page/related']) {
      assert.equal((await f.get(suffix, user, org)).statusCode, 404);
    }
    assert.equal((await f.get('/search?query=发票', user, org)).statusCode, 404);
    assert.equal((await f.get('/pages', user, org)).statusCode, 404);
    assert.equal((await f.app.inject({ method: 'POST', url: '/knowledge/kb/wiki/pages/page/publish',
      headers: { 'x-user': user, 'x-org': org }, payload })).statusCode, 404);
  }
  const db = new DatabaseSync(path.join(f.sourceRoot, 'sources.sqlite'));
  db.exec('DELETE FROM sources'); db.close();
  assert.equal((await f.get('/pages/page')).statusCode, 404);
  assert.equal((await f.get(`/pages/page?revisionId=${payload.draftRevisionId}`)).statusCode, 404);
  assert.deepEqual((await f.get('/search?query=发票')).json().items, []);
  assert.deepEqual((await f.get('/pages')).json().items, []);
});

test('WK-A02: strict boundaries, publication replay, human edits, CAS and archive replay', async (t) => {
  const f = fixture(t);
  for (const query of ['dataDir=/tmp', 'limit=51', 'limit=0', 'cursor=anything']) {
    assert.equal((await f.get('/search?query=发票&' + query)).statusCode, 400);
  }
  const { payload, result } = await f.publish();
  const send = (suffix: string, body: object, method: 'POST' | 'PUT' = 'POST') => f.app.inject({ method,
    url: '/knowledge/kb/wiki/pages/page/' + suffix, headers: { 'x-user': 'alice' }, payload: body });
  assert.deepEqual((await send('publish', payload)).json(), result.json());
  assert.equal((await send('publish', { ...payload, orgId: 'other' })).statusCode, 400);
  const edit = { baseGeneration: result.json().generation, idempotencyKey: 'edit', slug: 'page', content: f.content };
  assert.equal((await send('draft', { ...edit, authorType: 'model' }, 'PUT')).statusCode, 400);
  const saved = await send('draft', edit, 'PUT'); assert.equal(saved.statusCode, 200, saved.body);
  assert.equal((await f.get('/pages/page?view=drafts')).json().revision.authorType, 'human');
  assert.equal((await send('draft', { ...edit, idempotencyKey: 'conflict' }, 'PUT')).statusCode, 409);
  const archive = { baseGeneration: saved.json().generation, idempotencyKey: 'archive' };
  assert.equal((await send('archive', archive)).statusCode, 200);
  assert.equal((await send('archive', archive)).statusCode, 200);
  assert.equal((await f.get('/pages/page')).statusCode, 404);
  assert.deepEqual((await f.get('/search?query=发票')).json().items, []);
});

test('WK-A02: GET preserves v4, missing databases stay absent, configuration cannot be injected', async (t) => {
  const f = fixture(t, false);
  assert.deepEqual((await f.get('/pages')).json(), { items: [], nextAfterPageId: null });
  const db = new DatabaseSync(f.database, { readOnly: true });
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 4); db.close();
  const absent = path.join(f.root, 'not-created');
  fs.writeFileSync(path.join(f.root, 'knowledge-bases.json'), JSON.stringify([{ ...f.config[0], dataDir: absent }]));
  assert.deepEqual((await f.get('/search?query=发票')).json().items, []);
  assert.equal(fs.existsSync(absent), false);
  fs.writeFileSync(path.join(f.root, 'knowledge-bases.json'), JSON.stringify([{ ...f.config[0], enabled: false }]));
  assert.equal((await f.get('/pages')).statusCode, 404);
});

test('WK-A05: editable revision stays out of published reads/search until explicit publication; retry/CAS/history intact', async (t) => {
  const f = fixture(t); await f.publish();
  const published = (await f.get('/pages/page')).json();
  const body = '😀新的发票核对说明 EDIT731';
  const content = { ...f.content, title: '核对后的差旅说明', aliases: ['新别名731'], bodyMarkdown: body,
    sections: [{ ...f.content.sections[0], end: body.length }] };
  const payload = { baseGeneration: published.page.generation, idempotencyKey: 'edit-retry', slug: 'page', content };
  const edit = (value: object) => f.app.inject({ method: 'PUT', url: '/knowledge/kb/wiki/pages/page/draft', headers: { 'x-user': 'alice' }, payload: value });
  const saved = await edit(payload); assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual((await edit(payload)).json(), saved.json());
  assert.equal((await edit({ ...payload, idempotencyKey: 'racing' })).statusCode, 409);
  assert.deepEqual((await f.get('/search?query=EDIT731')).json().items, []);
  assert.equal((await f.get('/pages/page')).json().revision.revisionId, published.revision.revisionId);
  const draft = (await f.get('/pages/page?view=drafts')).json();
  assert.deepEqual(draft.revision.content.evidenceRefs, published.revision.content.evidenceRefs);
  assert.equal(draft.revision.authorType, 'human'); assert.equal(draft.revision.content.sections[0].end, body.length);
  const result = await f.app.inject({ method: 'POST', url: '/knowledge/kb/wiki/pages/page/publish', headers: { 'x-user': 'alice' },
    payload: { baseGeneration: draft.page.generation, idempotencyKey: 'publish-edited', draftRevisionId: draft.revision.revisionId, contentHash: draft.revision.contentHash } });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal((await f.get('/search?query=EDIT731')).json().items[0].pageId, 'page');
  assert.deepEqual((await f.get(`/pages/page?revisionId=${published.revision.revisionId}`)).json().revision.content, published.revision.content);
});

test('WK-A02: one-hop links and suppressed evidence disappear from API retrieval', async (t) => {
  const f = fixture(t);
  await f.publish();
  const store = new KnowledgeEvidenceStore(f.database);
  try {
    const wiki = store.openExistingWiki({ orgId: 'org', userId: 'alice', knowledgeBaseId: 'kb' }, () => true)!;
    const page = wiki.saveDraft({ pageId: 'second', slug: 'second', baseGeneration: 0, idempotencyKey: 'second', authorType: 'model',
      content: { ...f.content, title: '发票规则', links: [{ targetPageId: 'page', sourceSectionId: 's', label: '差旅报销' }] } });
    const revision = wiki.read('second', { draft: true })!.revision;
    wiki.publish({ pageId: 'second', baseGeneration: page.generation, idempotencyKey: 'second-publish',
      draftRevisionId: revision.revisionId, contentHash: revision.contentHash });
    const related = (await f.get('/pages/page/related')).json().items;
    assert.equal(related.length, 1); assert.equal(related[0].pageId, 'second'); assert.equal(related[0].direction, 'in');
    const first = (await f.get('/pages?limit=1')).json();
    assert.equal(first.items.length, 1);
    assert.equal((await f.get('/pages?limit=1&afterPageId=' + first.nextAfterPageId)).json().items[0].page.pageId, 'second');
    store.suppressChunks(['chunk']);
    assert.equal((await f.get('/pages/page')).statusCode, 404);
    assert.equal((await f.get('/pages/page/related')).statusCode, 404);
    assert.deepEqual((await f.get('/search?query=发票')).json().items, []);
  } finally { store.close(); }
});

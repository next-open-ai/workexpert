import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import type { ChatRequest } from '@workexpert/contracts';
import { KnowledgeCatalog, KnowledgeAccessError } from './catalog.js';
import { registerKnowledgeOwnershipRoutes } from './ownership-routes.js';
import { registerKnowledgeAccessGuard, authorizeRunKnowledge } from './access.js';
import { authGuard, localUserAuthService } from '../auth/service.js';

const alice = { orgId: 'org', userId: 'alice', role: 'member' };
const bob = { orgId: 'org', userId: 'bob', role: 'member' };
const admin = { orgId: 'org', userId: 'admin', role: 'admin' };
const base = (id = 'kb') => ({ id, name: id, provider: 'lancedb', apiKey: 'private-test-key' });
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workexpert-kb-owner-'));
  const file = path.join(root, 'knowledge-bases.json');
  const catalog = new KnowledgeCatalog(root);
  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    const user = request.headers['x-user'];
    if (typeof user === 'string') request.auth = { userId: user, orgId: String(request.headers['x-org'] || 'org'),
      username: user, displayName: user, role: user === 'admin' ? 'admin' : 'member', sessionId: 'test' };
  });
  registerKnowledgeOwnershipRoutes(app, { dataRoot: () => root, users: () => [
    { id: 'alice', orgId: 'org' }, { id: 'bob', orgId: 'org' }, { id: 'outside', orgId: 'other' }, { id: 'disabled', orgId: 'org', disabled: true },
  ] });
  app.register(async (knowledge) => {
    registerKnowledgeAccessGuard(knowledge, () => root);
    knowledge.post('/knowledge/search', async (request) => request.body);
  });
  const send = (url: string, user = 'alice', method: 'GET' | 'PUT' | 'POST' = 'GET', payload?: object, org = 'org') => app.inject({
    url, method, headers: { 'x-user': user, 'x-org': org }, ...(payload ? { payload } : {}),
  });
  t.after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, file, catalog, app, send };
}

test('WK-R04: Wiki switch is saved independently and access context always comes from the authorized host', async (t) => {
  const f = fixture(t);
  const initial = f.catalog.save(alice, [base()]);
  assert.notEqual(f.catalog.resolve(alice, 'kb').wikiRelatedExpansionEnabled, true);
  const rows = f.catalog.save(alice, [{ ...initial[0], wikiRetrievalEnabled: true, wikiRelatedExpansionEnabled: true, ontologyEnabled: false }]);
  const resolved = f.catalog.resolve(alice, 'kb');
  assert.equal(resolved.wikiRetrievalEnabled, true); assert.equal(resolved.ontologyEnabled, false);
  assert.deepEqual(resolved.wikiAccess, { orgId: 'org', userId: 'alice', sourceRoot: path.join(f.root, 'knowledge-sources') });
  assert.equal(rows[0].wikiAccess, undefined);
  assert.throws(() => f.catalog.save(alice, [{ ...rows[0], wikiAccess: { orgId: 'other', userId: 'bob', sourceRoot: '/foreign' } }]));
  const response = await f.send('/knowledge/search', 'alice', 'POST', { knowledgeBase: { ...base(),
    wikiRetrievalEnabled: false, wikiAccess: { orgId: 'other', userId: 'bob', sourceRoot: '/foreign' } } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().knowledgeBase.wikiAccess, resolved.wikiAccess);
  assert.equal(response.json().knowledgeBase.wikiRetrievalEnabled, true);
  assert.equal(response.json().knowledgeBase.wikiRelatedExpansionEnabled, true);
  f.catalog.save(alice, [{ ...rows[0], wikiRetrievalEnabled: false }]);
  assert.equal(f.catalog.resolve(alice, 'kb').wikiRetrievalEnabled, false);
  assert.equal(f.catalog.resolve(alice, 'kb').wikiRelatedExpansionEnabled, true);
});

test('WK-A03: new catalogs are owned, scoped saves preserve other users, administrators have no read override', async (t) => {
  const f = fixture(t);
  assert.equal((await f.app.inject('/settings/knowledge/bases')).statusCode, 401);
  const saved = await f.send('/settings/knowledge/bases', 'alice', 'PUT', [base()]);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json()[0].ownership.ownerUserId, 'alice');
  assert.equal(saved.json()[0].dataDir, path.join(f.root, 'knowledge-bases', 'kb'));
  assert.equal(fs.existsSync(saved.json()[0].dataDir), false);
  f.catalog.save(bob, [base('bob-kb')]);
  for (const user of ['bob', 'admin']) {
    const result = await f.send('/settings/knowledge/bases', user);
    assert.ok(!result.body.includes('"id":"kb"'));
    assert.equal((await f.send('/knowledge/search', user, 'POST', { knowledgeBase: base() })).statusCode, 404);
  }
  assert.equal((await f.send('/knowledge/search', 'alice', 'POST', { knowledgeBase: base() }, 'other')).statusCode, 404);
  f.catalog.save(alice, []);
  assert.equal(f.catalog.list(bob).length, 1);
  assert.throws(() => f.catalog.save(alice, [base()]), (e) => e instanceof KnowledgeAccessError && e.statusCode === 404);
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).meta.find((r: { id: string }) => r.id === 'kb').retired, true);
});

test('WK-A03: unowned legacy is inert, explicit admin assignment is same-org, idempotent and backed up', async (t) => {
  const f = fixture(t), legacy = JSON.stringify([base()]);
  fs.writeFileSync(f.file, legacy);
  assert.deepEqual(f.catalog.list(alice), []);
  assert.equal(fs.readFileSync(f.file, 'utf8'), legacy);
  assert.equal((await f.send('/settings/knowledge/unassigned')).statusCode, 403);
  const unassigned = await f.send('/settings/knowledge/unassigned', 'admin');
  assert.deepEqual(unassigned.json(), { items: [{ id: 'kb', name: 'kb', provider: 'lancedb' }] });
  const url = '/settings/knowledge/bases/kb/assign';
  assert.equal((await f.send(url, 'alice', 'POST', { ownerUserId: 'alice' })).statusCode, 403);
  for (const user of ['outside', 'disabled', 'unknown']) assert.equal((await f.send(url, 'admin', 'POST', { ownerUserId: user })).statusCode, 404);
  assert.equal((await f.send(url, 'admin', 'POST', { ownerUserId: 'alice', orgId: 'other' })).statusCode, 400);
  const assigned = await f.send(url, 'admin', 'POST', { ownerUserId: 'alice' });
  assert.equal(assigned.statusCode, 200, assigned.body);
  assert.deepEqual((await f.send(url, 'admin', 'POST', { ownerUserId: 'alice' })).json(), assigned.json());
  assert.equal((await f.send(url, 'admin', 'POST', { ownerUserId: 'bob' })).statusCode, 409);
  assert.equal(f.catalog.list(alice).length, 1); assert.equal(f.catalog.list(admin).length, 0);
  assert.equal(fs.readFileSync(f.file + '.pre-ownership.bak', 'utf8'), legacy);
});

test('WK-A03: ownership/path injection rejected, runtime uses saved location, removed IDs cannot be resurrected', async (t) => {
  const f = fixture(t);
  assert.throws(() => f.catalog.save(alice, [{ ...base(), dataDir: '/tmp/foreign' }]));
  assert.throws(() => f.catalog.save(alice, [base('../escape')]));
  assert.throws(() => f.catalog.save(alice, [{ ...base(), ownerUserId: 'bob' }]));
  const rows = f.catalog.save(alice, [base()]);
  assert.throws(() => f.catalog.save(bob, rows));
  assert.throws(() => f.catalog.save(alice, [{ ...rows[0], ownership: { ...rows[0].ownership, ownerUserId: 'bob' } }]));
  assert.throws(() => f.catalog.save(alice, [{ ...rows[0], dataDir: '/tmp/foreign' }]));
  const result = await f.send('/knowledge/search', 'alice', 'POST', { knowledgeBase: { ...base(), dataDir: '/tmp/foreign', apiKey: 'injected' } });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().knowledgeBase.dataDir, rows[0].dataDir);
  assert.equal(result.json().knowledgeBase.apiKey, 'private-test-key');
  const disk = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  assert.equal(disk.meta[0].apiKey, undefined);
  assert.equal(disk.secrets.bases.kb.apiKey, 'private-test-key');
});

test('WK-A03: desktop legacy snapshots remain unassigned and unchanged; conflicting catalogs fail closed', (t) => {
  const f = fixture(t), domain = path.join(f.root, 'domain.json');
  const bytes = JSON.stringify({ version: 1, kv: { 'user:alice:capabilities.knowledge': JSON.stringify([base('legacy')]) } });
  fs.writeFileSync(domain, bytes);
  assert.deepEqual(f.catalog.list(alice), []);
  assert.equal(f.catalog.unassigned(admin)[0].id, 'legacy');
  f.catalog.assign(admin, 'legacy', { id: 'alice', orgId: 'org' });
  assert.equal(fs.readFileSync(domain, 'utf8'), bytes);
  assert.equal(f.catalog.list(alice)[0].id, 'legacy');
  fs.writeFileSync(f.file, JSON.stringify([{ ...base('legacy'), dataDir: '/different' }]));
  assert.throws(() => f.catalog.list(alice), (e) => e instanceof KnowledgeAccessError && e.statusCode === 503);
});

test('WK-A03: corrupt/future catalogs are not silently reset or overwritten', async (t) => {
  const f = fixture(t);
  for (const bytes of ['{broken', JSON.stringify({ schemaVersion: 99, meta: [] }), JSON.stringify([base(), base()])]) {
    fs.writeFileSync(f.file, bytes);
    assert.equal((await f.send('/settings/knowledge/bases', 'alice', 'PUT', [base('new')])).statusCode, 503);
    assert.equal(fs.readFileSync(f.file, 'utf8'), bytes);
  }
});

test('WK-A03: failed atomic publication preserves original configuration and removes only its temporary file', (t) => {
  const f = fixture(t);
  f.catalog.save(alice, [base()]);
  const before = fs.readFileSync(f.file, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('injected rename failure'); };
  try { assert.throws(() => f.catalog.save(alice, []), /injected rename failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.equal(fs.readdirSync(f.root).some((name) => name.endsWith('.tmp')), false);
  assert.equal(f.catalog.list(alice).length, 1);
});

test('WK-A03: execution-boundary authorization rejects stale/client-injected run knowledge', (t) => {
  const f = fixture(t); f.catalog.save(alice, [base()]);
  const request = { knowledgeBases: [{ ...base(), dataDir: '/injected' }] } as unknown as ChatRequest;
  const valid = authorizeRunKnowledge(request, alice, f.root);
  assert.equal(valid.knowledgeBases[0].dataDir, path.join(f.root, 'knowledge-bases', 'kb'));
  assert.deepEqual(valid.knowledgeBases[0].wikiAccess, { orgId: 'org', userId: 'alice', sourceRoot: path.join(f.root, 'knowledge-sources') });
  for (const principal of [bob, admin, {}]) assert.throws(() => authorizeRunKnowledge(request, principal, f.root));
  f.catalog.save(alice, []);
  assert.throws(() => authorizeRunKnowledge(request, alice, f.root));
});

test('WK-A03: saved provider and embedding defaults survive canonical runtime resolution', (t) => {
  const f = fixture(t);
  f.catalog.save(alice, [{ ...base(), embeddingMode: 'system' }]);
  fs.writeFileSync(path.join(f.root, 'model-settings.json'), JSON.stringify({ meta: {
    activeEmbeddingModelId: 'embed', models: [{ id: 'embed', capability: 'embedding', modelId: 'text-embed', providerInstanceId: 'provider' }],
    providerInstances: [{ id: 'provider', type: 'openai-compatible', baseUrl: 'https://model.example/v1' }],
  }, secrets: { providerInstances: { provider: { apiKey: 'server-embedding-secret' } } } }));
  const runtime = f.catalog.resolve(alice, 'kb');
  assert.equal(runtime.embeddingModel, 'text-embed');
  assert.equal(runtime.embeddingBaseUrl, 'https://model.example/v1');
  assert.equal(runtime.embeddingApiKey, 'server-embedding-secret');
});

test('WK-A03: real session authentication and real user directory enforce administrator assignment', async (t) => {
  const f = fixture(t), previous = process.env.WORKEXPERT_DATA_DIR;
  process.env.WORKEXPERT_DATA_DIR = f.root;
  const app = Fastify();
  try {
    const service = localUserAuthService();
    const adminLogin = service.createInitialAdmin({ orgId: 'org', username: 'administrator', displayName: 'Admin', password: 'test-password' });
    const member = service.createUser({ orgId: 'org', username: 'member', displayName: 'Member', password: 'test-password' });
    const memberLogin = service.login({ username: 'member', password: 'test-password' });
    fs.writeFileSync(f.file, JSON.stringify([base()]));
    app.addHook('preHandler', authGuard()); registerKnowledgeOwnershipRoutes(app, { dataRoot: () => f.root });
    const url = '/settings/knowledge/bases/kb/assign', payload = { ownerUserId: member.id };
    assert.equal((await app.inject({ method: 'POST', url, payload })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url, payload, headers: { 'x-workexpert-session': memberLogin.token } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url, payload, headers: { 'x-workexpert-session': adminLogin.token } })).statusCode, 200);
    const listed = await app.inject({ url: '/settings/knowledge/bases', headers: { 'x-workexpert-session': memberLogin.token } });
    assert.equal(listed.json()[0].ownership.ownerUserId, member.id);
    assert.deepEqual((await app.inject({ url: '/settings/knowledge/bases', headers: { 'x-workexpert-session': adminLogin.token } })).json(), []);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.WORKEXPERT_DATA_DIR; else process.env.WORKEXPERT_DATA_DIR = previous;
  }
});

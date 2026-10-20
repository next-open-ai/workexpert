import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerOntologyAnalysisControls } from './ontology-analysis-controls.js';

test('ONT-29 control routes require ownership and reject stale batch numbers', async t => {
  const app = Fastify();
  t.after(() => app.close());
  app.addHook('preHandler', async request => {
    const user = request.headers['x-user'];
    if (typeof user === 'string') request.auth = { userId: user, orgId: 'org', username: user, displayName: user, role: 'member', sessionId: 'test' };
  });
  let skipped = 0, stopped = 0, persisted = 0;
  const id = '6a9b1155-f10d-4174-bd3f-a736d9325010';
  const job = { knowledgeBaseId: 'owned', status: 'running', phase: 'AI 识别', stopRequested: false, candidateIds: ['saved'], control: {
    skip: (batchNumber: number) => { if (batchNumber !== 2 || skipped || job.stopRequested) return false; skipped++; return true; },
    stop: () => { stopped++; },
  } };
  registerOntologyAnalysisControls(app, {
    findJob: requested => requested === id ? job : undefined,
    canAccess: (request, kb) => request.auth?.userId === 'alice' && kb === 'owned',
    publicJob: row => { const {control: _control, ...data} = row; return data; },
    persist: () => { persisted++; },
  });
  const send = (action: string, user?: string, batchNumber?: number) => app.inject({ method: 'POST', url: `/knowledge/ontology/analysis/${action}`, headers: user ? {'x-user':user} : {}, payload:{jobId:id,...(batchNumber === undefined ? {} : {batchNumber})} });
  assert.equal((await send('skip', undefined, 2)).statusCode, 401);
  assert.equal((await send('skip', 'bob', 2)).statusCode, 404);
  assert.equal((await send('stop', 'bob')).statusCode, 404);
  assert.equal(skipped + stopped, 0);
  assert.equal((await send('skip', 'alice', 0)).statusCode, 400);
  assert.equal((await send('skip', 'alice', 1)).statusCode, 409);
  assert.equal((await send('skip', 'alice', 2)).statusCode, 200);
  assert.equal((await send('skip', 'alice', 2)).statusCode, 409);
  assert.equal(skipped, 1);
  const stop = await send('stop', 'alice');
  assert.equal(stop.statusCode, 200);
  assert.equal(job.status, 'running');
  assert.equal(stop.json().job.stopRequested, true);
  assert.equal(stop.json().job.control, undefined);
  assert.deepEqual(stop.json().job.candidateIds, ['saved']);
  assert.equal(persisted, 1);
  assert.equal((await send('stop', 'alice')).statusCode, 200);
  assert.equal(stopped, 1);
  assert.equal(persisted, 1);
  assert.equal((await send('skip', 'alice', 2)).statusCode, 409);
  job.status = 'partial';
  assert.equal((await send('stop', 'alice')).statusCode, 200);
  assert.equal(stopped, 1);
});

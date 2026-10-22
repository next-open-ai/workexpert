import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { registerSourceIngest } from './source-ingest.js';
import type { KnowledgeSourceSnapshot } from '@workexpert/contracts';
import { readOwnedSourceFile } from '../assets/source-access.js';
import { KnowledgeCatalog } from './catalog.js';
import { MAX_LOCAL_KNOWLEDGE_FILE_BYTES, MAX_BAILIAN_KNOWLEDGE_FILE_BYTES } from '@workexpert/contracts';

test('KE-UP-T01: upload boundaries, Base64 expansion and no processing on rejection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workexpert-upload-limits-'));
  const principal = { orgId: 'org', userId: 'alice' };
  new KnowledgeCatalog(root).save(principal, [
    { id: 'local', name: 'Local', provider: 'lancedb' },
    { id: 'cloud', name: 'Cloud', provider: 'bailian' },
  ]);
  const app = Fastify();
  let calls = 0;
  app.addHook('preHandler', async (request) => {
    request.auth = { ...principal, username: 'alice', displayName: 'Alice', role: 'member', sessionId: 'test' };
  });
  registerSourceIngest(app, {
    dataRoot: () => root,
    identifyVersion: (_scope, bytes) => ({ sourceHash: createHash('sha256').update(bytes).digest('hex'),
      documentVersionId: 'dv-' + createHash('sha256').update(bytes).digest('hex') }),
    ingest: async () => { calls++; return { ok: true }; },
    readAsset: async () => ({ name: 'large.pdf', bytes: Buffer.alloc(MAX_LOCAL_KNOWLEDGE_FILE_BYTES + 1) }),
  });
  const post = (id: string, size: number) => app.inject({ method: 'POST', url: '/knowledge/ingest', payload: {
    knowledgeBase: { id, name: id, provider: 'lancedb' }, title: 'Boundary', fileName: 'test.pdf',
    fileBase64: Buffer.alloc(size, 65).toString('base64'),
  } });
  try {
    assert.equal((await post('local', 3_000_000)).statusCode, 200);
    assert.equal((await post('local', MAX_LOCAL_KNOWLEDGE_FILE_BYTES)).statusCode, 200);
    assert.equal((await post('cloud', MAX_BAILIAN_KNOWLEDGE_FILE_BYTES)).statusCode, 200);
    assert.equal(calls, 3);
    const archivedFiles = fs.readdirSync(path.join(root, 'knowledge-sources'), { recursive: true });
    assert.equal((await post('local', MAX_LOCAL_KNOWLEDGE_FILE_BYTES + 1)).statusCode, 413);
    assert.equal((await post('local', MAX_LOCAL_KNOWLEDGE_FILE_BYTES + 4)).statusCode, 413);
    assert.equal((await post('cloud', MAX_BAILIAN_KNOWLEDGE_FILE_BYTES + 1)).statusCode, 413);
    const asset = await app.inject({ method: 'POST', url: '/knowledge/ingest', payload: {
      knowledgeBase: { id: 'local', name: 'Local', provider: 'lancedb' }, title: 'Asset', assetId: 'oversized',
    } });
    assert.equal(asset.statusCode, 413);
    assert.equal(calls, 3);
    assert.deepEqual(fs.readdirSync(path.join(root, 'knowledge-sources'), { recursive: true }), archivedFiles);
  } finally { await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('KE-F04: source archive before ingest, exact bytes, ownership, failure retention and asset independence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workexpert-source-api-'));
  new KnowledgeCatalog(root).save({ orgId: 'org', userId: 'alice' }, [{ id: 'kb', name: 'Knowledge', provider: 'lancedb' }]);
  const assetsRoot = path.join(root, 'assets'); fs.mkdirSync(assetsRoot);
  const target = path.join(assetsRoot, 'asset.txt'); fs.writeFileSync(target, 'asset original');
  const app = Fastify();
  const ingested: Array<{ documentId?: string; content?: string; fileBase64?: string; sourceSnapshot?: KnowledgeSourceSnapshot }> = [];
  let fail = false;
  app.addHook('preHandler', async (request) => {
    const user = request.headers['x-user'];
    if (typeof user === 'string') request.auth = { userId: user, orgId: String(request.headers['x-org'] || 'org'),
      username: user, displayName: user, role: 'member', sessionId: 'test' };
  });
  registerSourceIngest(app, {
    dataRoot: () => root,
    identifyVersion: (scope, bytes) => ({ sourceHash: createHash('sha256').update(bytes).digest('hex'),
      documentVersionId: 'dv-' + createHash('sha256').update(JSON.stringify(scope)).update(bytes).digest('hex') }),
    ingest: async (input) => { ingested.push(input); if (fail) throw new Error('Mock embedding failed'); return { ok: true, documentId: input.documentId }; },
    readAsset: async (_id, owner) => readOwnedSourceFile({ owner, asset: { name: 'asset.txt', orgId: 'org', ownerUserId: 'alice' }, target, assetsRoot }),
  });
  const base = { knowledgeBase: { id: 'kb', name: 'Knowledge', provider: 'lancedb' }, title: 'Source' };
  const post = (fields: object, user = 'alice') => app.inject({ method: 'POST', url: '/knowledge/ingest', headers: { 'x-user': user }, payload: { ...base, ...fields } });
  const get = (version: string, user = 'alice', org = 'org') => app.inject({ method: 'GET', url: `/knowledge/sources/${version}`, headers: { 'x-user': user, 'x-org': org } });
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/knowledge/ingest', payload: { ...base, content: 'x' } })).statusCode, 401);
    const text = await post({ content: '  原文\r\n', fileBase64: Buffer.from('ignored').toString('base64') });
    assert.equal(text.statusCode, 200, text.body);
    const textSnapshot = text.json().sourceSnapshot;
    assert.equal(text.json().documentId, textSnapshot.documentId);
    assert.deepEqual(ingested[0].sourceSnapshot, textSnapshot);
    assert.equal(ingested[0].fileBase64, undefined);
    const download = await get(textSnapshot.documentVersionId);
    assert.equal(download.body, '  原文\r\n'); assert.equal(download.headers['cache-control'], 'no-store');
    assert.equal((await get(textSnapshot.documentVersionId, 'bob')).statusCode, 404);
    assert.equal((await get(textSnapshot.documentVersionId, 'alice', 'other')).statusCode, 404);
    const binary = Buffer.from([0, 255, 128, 42]);
    const upload = await post({ fileName: 'file.pdf', fileBase64: binary.toString('base64') });
    assert.equal(upload.statusCode, 200, upload.body);
    assert.deepEqual((await get(upload.json().sourceSnapshot.documentVersionId)).rawPayload, binary);
    assert.equal((await post({ assetId: 'asset', content: 'ambiguous' })).statusCode, 400);
    assert.equal((await post({ assetId: 'asset' }, 'bob')).statusCode, 404);
    const asset = await post({ assetId: 'asset' }); assert.equal(asset.statusCode, 200, asset.body);
    fs.writeFileSync(target, 'replacement'); fs.unlinkSync(target);
    assert.equal((await get(asset.json().sourceSnapshot.documentVersionId)).body, 'asset original');
    fail = true;
    const failed = await post({ content: 'retained' }); assert.equal(failed.statusCode, 400);
    assert.equal(failed.json().sourceSnapshot.status, 'archived');
    assert.equal((await get(failed.json().sourceSnapshot.documentVersionId)).body, 'retained');
    assert.equal((await post({ fileBase64: '%%%', fileName: 'bad.pdf' })).statusCode, 400);
  } finally { await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('KE-F04: asset bridge rejects legacy ownerless assets, foreign orgs, bundles and symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workexpert-source-access-'));
  const target = path.join(root, 'source'); fs.writeFileSync(target, 'data');
  const owner = { orgId: 'org', userId: 'alice' };
  const asset = { name: 'source', orgId: 'org', ownerUserId: 'alice' };
  try {
    for (const change of [{ ownerUserId: undefined }, { orgId: 'other' }, { kind: 'bundle' }]) {
      assert.throws(() => readOwnedSourceFile({ owner, asset: { ...asset, ...change }, target, assetsRoot: root }));
    }
    const link = path.join(root, 'link'); fs.symlinkSync(target, link);
    assert.throws(() => readOwnedSourceFile({ owner, asset, target: link, assetsRoot: root }), /Unsafe/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DK-T03: component failure reaches UI with stable code and retained original', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workexpert-component-error-'));
  const principal = { orgId: 'org', userId: 'alice' };
  new KnowledgeCatalog(root).save(principal, [{ id: 'kb', name: 'Knowledge', provider: 'lancedb' }]);
  const app = Fastify();
  const message = '当前安装包的本地检索组件缺失或不兼容，请安装修复版本后重试。';
  app.addHook('preHandler', async (request) => {
    request.auth = { ...principal, username: 'alice', displayName: 'Alice', role: 'member', sessionId: 'test' };
  });
  registerSourceIngest(app, {
    dataRoot: () => root,
    identifyVersion: (_scope, bytes) => ({ sourceHash: createHash('sha256').update(bytes).digest('hex'),
      documentVersionId: 'dv-' + createHash('sha256').update(bytes).digest('hex') }),
    ingest: async () => { throw Object.assign(new Error(message, { cause: new Error('/private/native/path') }), {
      code: 'KNOWLEDGE_STORAGE_COMPONENT_UNAVAILABLE',
    }); },
    readAsset: async () => { throw new Error('Not used'); },
  });
  try {
    const response = await app.inject({ method: 'POST', url: '/knowledge/ingest', payload: {
      knowledgeBase: { id: 'kb', name: 'Knowledge', provider: 'lancedb' }, title: 'Test', content: '原文保留',
    } });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'KNOWLEDGE_STORAGE_COMPONENT_UNAVAILABLE');
    assert.equal(response.json().message, message);
    assert.doesNotMatch(response.body, /private\/native/);
    const original = await app.inject({ method: 'GET', url: `/knowledge/sources/${response.json().sourceSnapshot.documentVersionId}` });
    assert.equal(original.statusCode, 200);
    assert.equal(original.body, '原文保留');
  } finally { await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

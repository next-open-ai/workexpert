import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packagedKnowledgeTargets } from '../apps/desktop/scripts/verify-packaged-knowledge.mjs';

const [target] = packagedKnowledgeTargets(path.resolve(process.argv[2] || 'apps/desktop/release'));
const root = mkdtempSync(path.join(tmpdir(), 'workexpert-packaged-api-'));
const embedding = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/embeddings') { response.writeHead(404).end(); return; }
  try {
    const parts = [];
    for await (const part of request) parts.push(part);
    const { input } = JSON.parse(Buffer.concat(parts).toString());
    const values = Array.isArray(input) ? input : [input];
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: values.map((_, index) => ({ index,
      embedding: Array.from({ length: 1024 }, (_, position) => position === 0 ? 1 : 0) })) }));
  } catch { response.writeHead(500).end(); }
});
let api;
let logs = '';
try {
  embedding.listen(0, '127.0.0.1');
  await once(embedding, 'listening');
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  api = spawn(target.executable, [path.join(target.api, 'main.cjs')], {
    cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: '', NODE_OPTIONS: '',
      WORKEXPERT_DATA_DIR: root, WORKEXPERT_API_HOST: '127.0.0.1', WORKEXPERT_API_PORT: String(port),
      WORKEXPERT_KNOWLEDGE_DIR: path.join(root, 'knowledge'), WORKEXPERT_SKILLS_DIR: path.join(root, 'skills'),
      WORKEXPERT_WORKSPACES_DIR: path.join(root, 'workspaces'), WORKEXPERT_EXPERIENCE_DIR: path.join(root, 'experience'),
      WORKEXPERT_AGENT_ENGINE: 'pi', WORKEXPERT_AGENTSCOPE_ENABLED: '0', WORKEXPERT_MOBILE_HTTPS_ENABLED: '0',
      WORKEXPERT_ORCH_RUNNER: 'memory-echo' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-8000); });
  api.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-8000); });
  api.on('error', (error) => { logs += error.message; });
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (api.exitCode !== null) throw new Error(`Packaged API exited: ${logs}`);
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, `Packaged API not ready: ${logs}`);
  let token = '';
  async function request(url, body, method = 'POST') {
    const response = await fetch(`${origin}/api${url}`, { method, signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', 'x-workexpert-session': token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    assert.ok(response.ok, `${url}: ${response.status} ${text}`);
    return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
  }
  token = (await request('/auth/bootstrap', { username: 'package-check', displayName: 'Package Check', password: 'TemporaryFixture-2026!' })).token;
  const kb = { id: 'package-probe', name: '安装包回归库', provider: 'lancedb', enabled: true,
    ontologyEnabled: false, embeddingModel: 'fixture-1024', embeddingApiKey: 'fixture-only',
    embeddingBaseUrl: `http://127.0.0.1:${embedding.address().port}/v1`, updatedAt: Date.now() };
  await request('/settings/knowledge/bases', [kb], 'PUT');
  const content = '# 鞋业制造本体\n\n' + '鞋底材料由质量负责人核验，检验合格后进入生产流程。\n'.repeat(100);
  // The desktop importer reads Markdown as UTF-8 and sends content, not the
  // binary-document parser input used for PDF/DOCX/PPTX.
  const ingested = await request('/knowledge/ingest', { knowledgeBase: kb, title: '安装包测试文档',
    fileName: 'manufacturing-ontology.md', content });
  assert.ok(ingested.chunks > 0, JSON.stringify(ingested));
  assert.equal(await request(`/knowledge/sources/${ingested.sourceSnapshot.documentVersionId}`, undefined, 'GET'), content);
  const recalled = await request('/knowledge/search', { knowledgeBase: kb, query: '鞋底材料质量负责人', topK: 5 });
  assert.ok(recalled.results.some((hit) => hit.content.includes('鞋底材料')), JSON.stringify(recalled));
  assert.ok(recalled.results.some((hit) => hit.evidence?.verification === 'versioned'));
  assert.ok(recalled.results.some((hit) => hit.retrieval?.channels.includes('vector')), 'Vector recall must not silently fall back to keyword-only results');
  console.log(`PACKAGED_API_OK: Markdown text import → ${ingested.chunks} chunks → 1024D indexing → source download → versioned recall (${recalled.results.length} hits)`);
} finally {
  if (api?.pid && api.exitCode === null && api.signalCode === null) {
    const closed = once(api, 'close');
    api.kill('SIGTERM');
    const timeout = setTimeout(() => api.kill('SIGKILL'), 5000);
    await closed;
    clearTimeout(timeout);
  }
  embedding.closeAllConnections();
  await new Promise((resolve) => embedding.close(resolve));
  rmSync(root, { recursive: true, force: true });
}

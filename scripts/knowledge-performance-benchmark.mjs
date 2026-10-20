import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, cpus, platform, arch } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { KnowledgeEvidenceStore } from '../packages/storage/dist/knowledge-evidence-store.js';
import { embedOpenAiCompatible } from '../packages/agent-core/dist/embedding-http.js';

// KE-P03 v1: synthetic, deterministic, no real provider or user data.
const dir = mkdtempSync(join(tmpdir(), 'workexpert-ke-p03-'));
const store = new KnowledgeEvidenceStore(join(dir, 'evidence.sqlite'));
const hash = text => createHash('sha256').update(text).digest('hex');
const scope = { provider: 'lancedb', knowledgeBaseId: 'bench', documentId: 'doc' };
const chunks = Array.from({ length: 400 }, (_, i) => {
  const content = `条款${i} ${'知识检索性能测试 '.repeat(40)}`;
  return { content, evidence: { schemaVersion: 1, verification: 'versioned', ...scope,
    documentVersionId: 'v1', processingRevisionId: 'r1', chunkId: `ch-${i}`, contentHash: hash(content) } };
});
const originalFetch = globalThis.fetch;
try {
  store.putBatch({ ...scope, documentVersionId: 'v1', processingRevisionId: 'r1', sourceHash: hash('raw'), chunks });
  const ids = chunks.slice(0, 40).map(chunk => chunk.evidence.chunkId);
  const before = () => ids.map(id => store.getEvidence(id));
  const after = () => { const results = store.getEvidenceMany(ids); return ids.map(id => results.get(id)); };
  assert.deepEqual(after(), before());
  for (let i = 0; i < 3; i++) { before(); after(); }
  const samples = { before: [], after: [] };
  for (let i = 0; i < 20; i++) {
    for (const name of i % 2 ? ['after', 'before'] : ['before', 'after']) {
      const start = performance.now(); (name === 'before' ? before : after)();
      samples[name].push(performance.now() - start);
    }
  }
  const stats = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return { medianMs: (sorted[9] + sorted[10]) / 2, p95Ms: sorted[18] };
  };
  let requests = 0, submitted = 0;
  globalThis.fetch = async (_url, init) => {
    const { input } = JSON.parse(init.body); requests++; submitted += input.length;
    return new Response(JSON.stringify({ data: input.map(text => ({ embedding: [Number(text), 1] })) }));
  };
  const inputs = Array.from({ length: 400 }, (_, i) => String(i % 100));
  const embedded = await embedOpenAiCompatible({ baseUrl: 'https://benchmark.invalid', apiKey: '', model: 'mock', maxBatch: 32 }, inputs);
  assert.deepEqual(embedded.vectors.map(vector => vector[0]), inputs.map(Number));
  console.log(JSON.stringify({ benchmark: 'KE-P03-v1', date: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workingTree: 'dirty',
    node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
    fixtureSha256: hash(JSON.stringify(chunks)), chunks: 400, hits: 40, warmup: 3, rounds: 20,
    evidence: { before: stats(samples.before), after: stats(samples.after), samples },
    embedding: { inputs: 400, unique: 100, baselineRequests: 13, requests, submitted,
      note: 'deterministic mock; baseline request count calculated from original sequential batching; not provider latency' },
  }, null, 2));
} finally { globalThis.fetch = originalFetch; store.close(); rmSync(dir, { recursive: true, force: true }); }

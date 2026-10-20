import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ingestKnowledge, listLocalKnowledgeDocuments } from '../knowledge-runtime.js';

test('KE-F04: ingestion keeps the API source document identity; legacy callers still get an ID', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workexpert-source-id-'));
  const kb = { id: 'kb', name: 'Knowledge', provider: 'lancedb' as const, enabled: true, dataDir: root,
    embeddingBaseUrl: 'https://embedding.invalid/v1', embeddingApiKey: 'test', embeddingModel: 'test-model' };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ model: 'test-model',
    data: [{ index: 0, embedding: [1, 0, 0] }], usage: { prompt_tokens: 1, total_tokens: 1 } }),
  { status: 200, headers: { 'content-type': 'application/json' } }));
  try {
    const result = await ingestKnowledge({ kb, documentId: 'source-document', title: 'Source', content: 'Some source text.' });
    assert.equal('documentId' in result && result.documentId, 'source-document');
    const legacy = await ingestKnowledge({ kb, title: 'Legacy', content: 'Other source text.' });
    assert.ok('documentId' in legacy && legacy.documentId && legacy.documentId !== 'source-document');
    const documents = await listLocalKnowledgeDocuments(kb);
    assert.ok(documents.documents.some((document) => document.id === 'source-document'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

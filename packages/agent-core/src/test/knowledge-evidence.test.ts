import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeEvidenceSchema } from '@workexpert/contracts';
import { identifyKnowledgeVersion, identifyKnowledgeProcessing, createVersionedKnowledgeEvidence, legacyKnowledgeEvidence } from '../knowledge-evidence.js';

const scope = { provider: 'lancedb', knowledgeBaseId: 'kb', documentId: 'doc' };
const bytes = Buffer.from('采购制度\r\n');
const recipe = { parser: 'text-v1', chunker: 'fixed-v1', config: { size: 1200, overlap: 120 } };

test('KE-02: document versions preserve byte changes and isolate KB/document/provider scope', () => {
  const version = identifyKnowledgeVersion(scope, bytes);
  assert.deepEqual(version, identifyKnowledgeVersion(scope, bytes));
  assert.notEqual(version.documentVersionId, identifyKnowledgeVersion(scope, Buffer.from('采购制度\n')).documentVersionId);
  for (const key of ['knowledgeBaseId', 'documentId', 'provider'] as const) {
    assert.notEqual(version.documentVersionId, identifyKnowledgeVersion({ ...scope, [key]: 'other' }, bytes).documentVersionId);
  }
});

test('KE-02: reprocessing identity is deterministic across key order, changes with recipe', () => {
  const version = identifyKnowledgeVersion(scope, bytes).documentVersionId;
  const processing = identifyKnowledgeProcessing(version, recipe);
  assert.equal(processing, identifyKnowledgeProcessing(version, { ...recipe, config: { overlap: 120, size: 1200 } }));
  assert.notEqual(processing, identifyKnowledgeProcessing(version, { ...recipe, chunker: 'heading-v1' }));
  assert.throws(() => identifyKnowledgeProcessing(version, { ...recipe, config: { size: NaN } }));
});

test('KE-01: chunk identity distinguishes repeated passages and validates source positions', () => {
  const documentVersionId = identifyKnowledgeVersion(scope, bytes).documentVersionId;
  const input = { scope, documentVersionId, processingRevisionId: identifyKnowledgeProcessing(documentVersionId, recipe), ordinal: 0, content: '材料要求' };
  const evidence = createVersionedKnowledgeEvidence(input);
  assert.deepEqual(evidence, createVersionedKnowledgeEvidence(input));
  assert.notEqual(evidence.chunkId, createVersionedKnowledgeEvidence({ ...input, ordinal: 1 }).chunkId);
  assert.notEqual(evidence.chunkId, createVersionedKnowledgeEvidence({ ...input, content: '豁免规则' }).chunkId);
  assert.throws(() => createVersionedKnowledgeEvidence({ ...input, sourceLocation: { coordinateSystem: 'normalized-text-utf16', start: 4, end: 2 } }));
  assert.ok(KnowledgeEvidenceSchema.safeParse(createVersionedKnowledgeEvidence({ ...input, parentChunkId: 'parent', sourceLocation: { coordinateSystem: 'normalized-text-utf16', start: 0, end: 4 } })).success);
});

test('KE-03: legacy references retain IDs without fabricated version or location', () => {
  const legacy = legacyKnowledgeEvidence(scope, 'original-chunk');
  assert.equal(legacy.chunkId, 'original-chunk');
  assert.equal(legacy.verification, 'legacy-unverified');
  assert.equal('documentVersionId' in legacy, false);
  assert.equal(KnowledgeEvidenceSchema.safeParse({ ...legacy, documentVersionId: 'invented' }).success, false);
  assert.equal(KnowledgeEvidenceSchema.safeParse({ ...legacy, verification: 'versioned' }).success, false);
});

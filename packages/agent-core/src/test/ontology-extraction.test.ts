import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeOntologyExtractionError,
  OntologyExtractionControl,
  extractOntologyCandidateBatches,
  normalizeOntologyExtraction,
  ontologyExtractionConcurrency,
  partitionOntologyExtractionChunks,
  prioritizeOntologyExtractionChunks,
} from '../ontology-extraction.js';

const chunks = [{ id: 'chunk-1', documentId: 'doc-1', documentTitle: '退款规则', source: 'refund.md', content: '退款未到账属于售后问题。' }];

test('ONT-29 skip aborts only the named batch, continues later chunks and discards late output', { timeout: 3000 }, async () => {
  const control = new OntologyExtractionControl();
  const inputs = [1, 2, 3].map(n => ({ ...chunks[0]!, id: `skip-${n}` }));
  const output = (chunk: {id:string;content:string}) => JSON.stringify({ nodes: [{ id: chunk.id, type: 'concept', name: chunk.id, evidence: { chunkId: chunk.id, quote: chunk.content } }], edges: [] });
  let started!: () => void, late!: (value: string) => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const calls: string[] = [], saved: string[] = [], failures: string[] = [];
  const work = extractOntologyCandidateBatches(inputs, async (batch, signal) => {
    const chunk = batch[0]!;
    calls.push(chunk.id);
    if (chunk.id === 'skip-2') {
      assert.equal(signal?.aborted, false);
      started();
      return new Promise<string>(resolve => { late = resolve; });
    }
    return output(chunk);
  }, { control, concurrency: 1, maxChunks: 1, continueOnError: true, maxConsecutiveSameFailures: 1,
    onBatchComplete: (_items, batch) => { saved.push(batch[0]!.id); },
    onBatchFailed: (_batch, _error, failure) => { failures.push(failure.category); } });
  await waiting;
  assert.equal(control.skip(1), false);
  assert.equal(control.skip(2), true);
  assert.equal(control.skip(2), false);
  const result = await work;
  late(output(inputs[1]!));
  await Promise.resolve();
  assert.deepEqual(calls, ['skip-1', 'skip-2', 'skip-3']);
  assert.deepEqual(saved, ['skip-1', 'skip-3']);
  assert.deepEqual(result.map(item => item.node?.name), ['skip-1', 'skip-3']);
  assert.deepEqual(failures, ['user_skipped']);
});

test('ONT-29 stop cancels every active request and never submits queued chunks', { timeout: 3000 }, async () => {
  const control = new OntologyExtractionControl();
  const inputs = [1, 2, 3, 4].map(n => ({ ...chunks[0]!, id: `stop-${n}` }));
  let ready!: () => void;
  const waiting = new Promise<void>(resolve => { ready = resolve; });
  const calls: string[] = [], saved: string[] = [], remaining: string[] = [];
  let hanging = 0;
  const work = extractOntologyCandidateBatches(inputs, async batch => {
    const chunk = batch[0]!;
    calls.push(chunk.id);
    if (chunk.id === 'stop-1') return JSON.stringify({ nodes: [{ id: chunk.id, type: 'concept', name: chunk.id, evidence: { chunkId: chunk.id, quote: chunk.content } }], edges: [] });
    if (++hanging === 2) ready();
    return new Promise<string>(() => {});
  }, { control, concurrency: 2, maxChunks: 1, continueOnError: true,
    onBatchComplete: (_items, batch) => { saved.push(batch[0]!.id); },
    onBatchFailed: (batch, _error, failure) => { assert.equal(failure.category, 'user_stopped'); remaining.push(...batch.map(chunk => chunk.id)); } });
  await waiting;
  control.stop();
  const result = await work;
  assert.deepEqual(calls, ['stop-1', 'stop-2', 'stop-3']);
  assert.deepEqual(saved, ['stop-1']);
  assert.equal(result.length, 1);
  assert.deepEqual(remaining.sort(), ['stop-2', 'stop-3', 'stop-4']);
});

test('ONT-29 stop waits for an already successful batch to finish saving', { timeout: 3000 }, async () => {
  const control = new OntologyExtractionControl();
  let saving!: () => void, releaseSave!: () => void;
  const enteredSave = new Promise<void>(resolve => { saving = resolve; });
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  let calls = 0, persisted = false;
  const work = extractOntologyCandidateBatches([chunks[0]!, { ...chunks[0]!, id: 'later' }], async () => {
    calls++;
    return JSON.stringify({ nodes: [{ id: 'kept', type: 'concept', name: '已完成', evidence: { chunkId: chunks[0]!.id, quote: chunks[0]!.content } }], edges: [] });
  }, { control, concurrency: 1, maxChunks: 1, continueOnError: true, onBatchComplete: async () => { saving(); await saveGate; persisted = true; } });
  await enteredSave;
  control.stop();
  assert.equal(control.skip(1), false);
  assert.equal(persisted, false);
  releaseSave();
  assert.equal((await work).length, 1);
  assert.equal(persisted, true);
  assert.equal(calls, 1);
});

test('ontology extraction normalizes fenced model JSON into evidence-bound candidates', () => {
  const result = normalizeOntologyExtraction(`说明如下：\n\`\`\`json
  {"nodes":[{"id":"refund_pending","type":"issue","name":"退款未到账","aliases":["退款没收到"],"properties":{},"confidence":0.91,"evidence":{"chunkId":"chunk-1","quote":"退款未到账属于售后问题"}},{"id":"after_sales","type":"service","name":"售后","aliases":[],"properties":{},"confidence":0.85,"evidence":{"chunkId":"chunk-1","quote":"属于售后问题"}}],"edges":[{"subjectId":"refund_pending","predicate":"属于","objectId":"after_sales","properties":{},"confidence":0.88,"evidence":{"chunkId":"chunk-1","quote":"退款未到账属于售后问题"}}]}
  \`\`\``, chunks);
  assert.equal(result.length, 3);
  assert.equal(result.every((item) => item.status === 'pending'), true);
  assert.equal(result.every((item) => item.evidence[0]?.documentId === 'doc-1'), true);
  assert.equal(result.find((item) => item.kind === 'edge')?.edge?.predicate, '属于');
});

test('ontology extraction rejects evidence outside the selected chunks', () => {
  assert.throws(() => normalizeOntologyExtraction(JSON.stringify({
    nodes: [{ id: 'x', type: 'concept', name: 'X', evidence: { chunkId: 'chunk-other', quote: 'unknown' } }],
    edges: [],
  }), chunks), /未授权的知识切片/);
});

test('ontology extraction rejects a quote that is not present in the authorized chunk', () => {
  assert.throws(() => normalizeOntologyExtraction(JSON.stringify({
    nodes: [{ id: 'x', type: 'concept', name: 'X', evidence: { chunkId: 'chunk-1', quote: '文档中不存在的结论' } }],
    edges: [],
  }), chunks), /无法在原文中核验的证据/);
});

test('batched ontology extraction discards unverifiable candidates but keeps verified candidates', async () => {
  const result = await extractOntologyCandidateBatches(chunks, async () => JSON.stringify({
    nodes: [
      { id: 'verified', type: 'concept', name: '退款未到账', evidence: { chunkId: 'chunk-1', quote: '退款未到账属于售后问题' } },
      { id: 'invented', type: 'concept', name: '编造结论', evidence: { chunkId: 'chunk-1', quote: '原文中没有这句话' } },
    ],
    edges: [{ subjectId: 'verified', predicate: '关联', objectId: 'invented', evidence: { chunkId: 'chunk-1', quote: '退款未到账属于售后问题' } }],
  }));
  assert.equal(result.length, 1);
  assert.equal(result[0]?.node?.id, 'verified');
});

test('batched extraction safely repairs a wrong evidence id from an unambiguous quote', async () => {
  const result = await extractOntologyCandidateBatches(chunks, async () => JSON.stringify({
    nodes: [{ id: 'refund', type: 'concept', name: '退款问题', evidence: { chunkId: 'hallucinated-id', quote: '退款未到账属于售后问题' } }],
    edges: [],
  }));
  assert.equal(result.length, 1);
  assert.equal(result[0]?.evidence[0]?.chunkId, 'chunk-1');
});

test('batched extraction skips an unauthorized candidate that cannot be verified', async () => {
  const result = await extractOntologyCandidateBatches(chunks, async () => JSON.stringify({
    nodes: [
      { id: 'verified', type: 'concept', name: '退款问题', evidence: { chunkId: 'chunk-1', quote: '退款未到账属于售后问题' } },
      { id: 'unsafe', type: 'concept', name: '外部信息', evidence: { chunkId: 'other-batch', quote: '不在原文中的内容' } },
    ],
    edges: [],
  }));
  assert.deepEqual(result.map((item) => item.node?.id), ['verified']);
});

test('batched extraction retries a transient terminated connection without user action', async () => {
  let calls = 0;
  const result = await extractOntologyCandidateBatches(chunks, async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('terminated', { cause: Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' }) });
    return JSON.stringify({
      nodes: [{ id: 'refund', type: 'concept', name: '退款问题', evidence: { chunkId: 'chunk-1', quote: '退款未到账属于售后问题' } }],
      edges: [],
    });
  });
  assert.equal(calls, 2);
  assert.equal(result.length, 1);
});

test('transient failures use one retry and do not recursively split the batch', async () => {
  let calls = 0;
  await assert.rejects(
    () => extractOntologyCandidateBatches(chunks, async () => {
      calls += 1;
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' }) });
    }),
    /连接暂时中断/,
  );
  assert.equal(calls, 2);
});

test('ontology extraction partitions documents without splitting chunk contents', () => {
  const manyChunks = Array.from({ length: 13 }, (_, index) => ({
    id: `chunk-${index + 1}`,
    documentId: 'doc-1',
    documentTitle: '材料',
    content: `内容-${index + 1}`,
  }));
  const batches = partitionOntologyExtractionChunks(manyChunks);
  assert.deepEqual(batches.map((batch) => batch.length), [3, 3, 3, 3, 1]);
  assert.deepEqual(batches.flat().map((chunk) => chunk.id), manyChunks.map((chunk) => chunk.id));
});

test('ontology extraction prioritizes business-dense and user-focused chunks without dropping content', () => {
  const input = [
    { id: 'footer', documentId: 'doc-1', documentTitle: '材料', content: '版权声明与免责声明。' },
    { id: 'workflow', documentId: 'doc-1', documentTitle: '退款流程', content: '客服负责退款审批流程，异常订单触发人工处理。' },
    { id: 'product', documentId: 'doc-1', documentTitle: '产品', content: '产品参数说明。' },
  ];
  const ranked = prioritizeOntologyExtractionChunks(input, '退款审批');
  assert.equal(ranked[0]?.id, 'workflow');
  assert.deepEqual(new Set(ranked.map((chunk) => chunk.id)), new Set(input.map((chunk) => chunk.id)));
});

test('ontology extraction uses adaptive bounded concurrency for cloud and local models', () => {
  assert.equal(ontologyExtractionConcurrency({ provider: 'qwen' }), 1);
  assert.equal(ontologyExtractionConcurrency({ provider: 'openai' }), 4);
  assert.equal(ontologyExtractionConcurrency({ provider: 'ollama' }), 1);
});

test('ontology extraction classifies failures for diagnostics without exposing an opaque generic status', () => {
  assert.equal(describeOntologyExtractionError(new Error('Request was aborted after timeout')).category, 'provider_timeout');
  assert.equal(describeOntologyExtractionError(new Error('finish_reason length limit')).category, 'output_truncated');
  assert.equal(describeOntologyExtractionError(new Error('response_format json_schema unsupported')).category, 'schema_unsupported');
  assert.equal(describeOntologyExtractionError(new Error('HTTP status code 429')).category, 'provider_http');
});

test('ontology extraction opens a circuit after two repeated retryable failures', async () => {
  const input = Array.from({ length: 4 }, (_, index) => ({ ...chunks[0]!, id: `chunk-${index + 1}` }));
  let modelCalls = 0;
  const failures: string[] = [];
  await extractOntologyCandidateBatches(input, async () => {
    modelCalls += 1;
    throw new Error('Request was aborted after timeout');
  }, {
    maxChunks: 1,
    concurrency: 1,
    continueOnError: true,
    onBatchFailed: (_batch, _error, failure) => { failures.push(failure.category); },
  });
  assert.equal(modelCalls, 4); // two attempts for each of the first two batches
  assert.deepEqual(failures, ['provider_timeout', 'provider_timeout', 'deferred_after_repeated_failure', 'deferred_after_repeated_failure']);
});

test('a content-local output error skips only that batch and continues later chunks', async () => {
  const input = Array.from({ length: 3 }, (_, index) => ({ ...chunks[0]!, id: `local-${index + 1}`, content: `实体${index + 1}属于分类。` }));
  const failures: string[] = [];
  const result = await extractOntologyCandidateBatches(input, async (batch) => {
    if (batch[0]!.id === 'local-2') return '{"nodes":[';
    const chunk = batch[0]!;
    return JSON.stringify({ nodes: [{ id: chunk.id, type: 'concept', name: chunk.id, evidence: { chunkId: chunk.id, quote: chunk.content } }], edges: [] });
  }, {
    maxChunks: 1,
    maxFallbackDepth: 0,
    concurrency: 1,
    continueOnError: true,
    onBatchFailed: (_batch, _error, failure) => { failures.push(failure.category); },
  });
  assert.deepEqual(result.map((candidate) => candidate.node?.id), ['local-1', 'local-3']);
  assert.deepEqual(failures, ['invalid_output']);
});

test('continue-on-error keeps an all-failed task resumable instead of discarding its checkpoint', async () => {
  const failed: string[] = [];
  const result = await extractOntologyCandidateBatches(chunks, async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' }) });
  }, {
    continueOnError: true,
    onBatchFailed: (batch) => { failed.push(...batch.map((chunk) => chunk.id)); },
  });
  assert.deepEqual(result, []);
  assert.deepEqual(failed, ['chunk-1']);
});

test('ontology extraction runs top-level batches with bounded concurrency and preserves batch order', async () => {
  const manyChunks = Array.from({ length: 18 }, (_, index) => ({
    id: `chunk-${index + 1}`,
    documentId: 'doc-1',
    documentTitle: '材料',
    content: `实体${index + 1}属于分类。`,
  }));
  let active = 0;
  let maxActive = 0;
  const result = await extractOntologyCandidateBatches(manyChunks, async (batch) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    const batchNumber = Number(batch[0]!.id.split('-')[1]);
    await new Promise((resolve) => setTimeout(resolve, batchNumber === 1 ? 25 : 5));
    active -= 1;
    const chunk = batch[0]!;
    return JSON.stringify({
      nodes: [{ id: `entity_${chunk.id}`, type: 'concept', name: `实体${batchNumber}`, evidence: { chunkId: chunk.id, quote: chunk.content } }],
      edges: [],
    });
  });
  assert.equal(maxActive, 2);
  assert.deepEqual(result.map((candidate) => candidate.node?.name), ['实体1', '实体4', '实体7', '实体10', '实体13', '实体16']);
});

test('ontology extraction preserves successful batches when another batch fails', async () => {
  const partialChunks = [chunks[0]!, { ...chunks[0]!, id: 'chunk-2', content: '第二批内容用于故障恢复测试。' }];
  const completed: string[] = [];
  const failed: string[] = [];
  const progress: Array<{ activeBatches?: Array<{ state: string; batchNumber: number }> }> = [];
  const result = await extractOntologyCandidateBatches(partialChunks, async (batch) => {
    const chunk = batch[0]!;
    if (chunk.id === partialChunks[1]!.id) throw new Error('Request was aborted');
    return JSON.stringify({ nodes: [{ id: 'kept', type: 'concept', name: '已保存实体', evidence: { chunkId: chunk.id, quote: chunk.content } }], edges: [] });
  }, {
    maxChunks: 1,
    concurrency: 1,
    continueOnError: true,
    onBatchComplete: (_items, batch) => { completed.push(batch[0]!.id); },
    onBatchFailed: (batch) => { failed.push(batch[0]!.id); },
    onProgress: (event) => { progress.push(event); },
  });
  assert.equal(result.length, 1);
  assert.deepEqual(completed, [partialChunks[0]!.id]);
  assert.deepEqual(failed, [partialChunks[1]!.id]);
  assert.equal(progress.some((event) => event.activeBatches?.some((batch) => batch.state === 'running' && batch.batchNumber === 1)), true);
  assert.equal(progress.some((event) => event.activeBatches?.some((batch) => batch.state === 'failed' && batch.batchNumber === 2)), true);
});

test('ontology extraction splits and retries a batch when model JSON is incomplete', async () => {
  const retryChunks = Array.from({ length: 4 }, (_, index) => ({
    id: `chunk-${index + 1}`,
    documentId: 'doc-1',
    documentTitle: '材料',
    content: `实体${index + 1}属于分类。`,
  }));
  const calls: string[][] = [];
  const result = await extractOntologyCandidateBatches(retryChunks, async (batch) => {
    calls.push(batch.map((chunk) => chunk.id));
    if (batch.length > 2) return '{"nodes":[';
    const chunk = batch[0]!;
    return JSON.stringify({
      nodes: [{ id: `entity_${chunk.id}`, type: 'concept', name: `实体${chunk.id}`, evidence: { chunkId: chunk.id, quote: chunk.content } }],
      edges: [],
    });
  }, { maxChunks: 4 });
  assert.deepEqual(calls.map((call) => call.length), [4, 2, 2]);
  assert.equal(result.length, 2);
});

test('ontology extraction reports a readable error when one chunk repeatedly returns invalid JSON', async () => {
  const shortChunk = [{ ...chunks[0]!, content: '短内容。' }];
  await assert.rejects(
    () => extractOntologyCandidateBatches(shortChunk, async () => '{"nodes":['),
    /返回的结构化结果不完整，请重试或减少分析范围/,
  );
});

test('ontology extraction splits dense single-chunk text for retry without changing its evidence id', async () => {
  const denseChunk = {
    id: 'chunk-dense',
    documentId: 'doc-1',
    documentTitle: '密集材料',
    content: `${'甲产品属于材料分类。'.repeat(45)}\n${'乙产品属于材料分类。'.repeat(45)}`,
  };
  const calls: Array<{ id: string; chars: number }> = [];
  const result = await extractOntologyCandidateBatches([denseChunk], async (batch) => {
    const chunk = batch[0]!;
    calls.push({ id: chunk.id, chars: chunk.content.length });
    if (chunk.content.length > 700) return '{"nodes":[';
    const quote = chunk.content.slice(0, Math.min(12, chunk.content.length));
    return JSON.stringify({
      nodes: [{ id: `entity_${calls.length}`, type: 'concept', name: `实体${calls.length}`, evidence: { chunkId: chunk.id, quote } }],
      edges: [],
    });
  });
  assert.equal(calls.length > 1, true);
  assert.equal(calls.every((call) => call.id === denseChunk.id), true);
  assert.equal(result.length > 1, true);
  assert.equal(result.every((candidate) => candidate.evidence[0]?.chunkId === denseChunk.id), true);
});

test('AI governance normalizer safely completes missing merge command fields', async () => {
  const { normalizeAiGovernanceCommands } = await import('../ontology-extraction.js');
  const graph = { version: 1, nodes: [
    { id: 'a', type: 'Indicator', name: 'shoe_weight', aliases: [], properties: {}, status: 'draft' as const },
    { id: 'b', type: 'Indicator', name: 'indicator_shoe_weight', aliases: [], properties: {}, status: 'draft' as const },
  ], edges: [] };
  const issue = { id: 'duplicate:shoeweight', category: 'duplicate_node' as const, severity: 'warning' as const, title: '重复', description: '', nodeIds: ['a', 'b'], edgeIds: [], suggestedCommands: [] };
  assert.deepEqual(normalizeAiGovernanceCommands([{ type: 'merge_nodes', nodeIds: ['a', 'b'] }], issue, graph), [{ type: 'merge_nodes', nodeIds: ['a', 'b'], canonicalId: 'a', canonicalName: 'shoe_weight' }]);
  assert.deepEqual(normalizeAiGovernanceCommands([{ type: 'rename_node', nodeId: 'a' }], issue, graph), []);
});

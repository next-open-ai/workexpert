import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { KnowledgeBaseRuntime, KnowledgeSourceSnapshot } from '@workexpert/contracts';
import { identifyKnowledgeVersion, knowledgeContentHash } from '../knowledge-evidence.js';
import { ingestKnowledge, searchKnowledgeBase, deleteLocalKnowledgeDocument } from '../knowledge-runtime.js';

// Authored synthetic fixtures, not customer policies or a semantic model benchmark.
const documents = [
  { id: 'travel', title: '差旅报销制度', content: '# 差旅报销\n\n差旅报销须提交行程单和发票，审批人为直属主管。' },
  { id: 'access', title: '星桥访问管理', content: '# 访问管理\n\n星桥账号开通需要部门负责人确认。离职当天撤销访问权限。' },
  { id: 'incident', title: '故障处理', content: '# 故障处理\n\n出现 ERR-AX904 时，检查网关证书，不要重复提交订单。' },
  { id: 'backup', title: '备份操作', content: '# Backup\n\nSNAPSHOT_RESTORE requires an administrator. Verify the checksum before restoring.' },
  { id: 'limits', title: '费用标准', content: '# 住宿标准\n\n| 城市 | 住宿限额 |\n| --- | --- |\n| 海岚 | 650 元 |\n| 云港 | 480 元 |' },
  { id: 'onboarding', title: '入职清单', content: '# 入职清单\n\n- 领取门禁卡\n- 签署保密协议\n- 完成安全培训' },
  { id: 'leave', title: '休假规定', content: '# 休假\n\n年假须提前三个工作日申请。' },
  { id: 'sales', title: '采购流程', content: '# 采购\n\n设备采购须提供供应商报价，经预算负责人审核。' },
];
const cases = [
  ['中文制度', '差旅报销', 'travel'],
  ['专有名词', '星桥', 'access'],
  ['错误编号', 'ERR-AX904', 'incident'],
  ['全半角编号', 'ＥＲＲ－ＡＸ９０４', 'incident'],
  ['英文大小写', 'snapshot_restore', 'backup'],
  ['表格字段', '住宿限额', 'limits'],
  ['表格单元格', '海岚', 'limits'],
  ['列表项目', '保密协议', 'onboarding'],
  ['短中文词', '年假', 'leave'],
  ['业务角色', '预算负责人', 'sales'],
] as const;

test('KE-A01/A02: synthetic keyword acceptance, evidence and deletion (not semantic quality)', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workexpert-acceptance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const kb: KnowledgeBaseRuntime = { id: 'acceptance', name: '模拟验收', provider: 'lancedb', enabled: true,
    dataDir: root, embeddingBaseUrl: 'https://embedding.invalid/v1', embeddingApiKey: 'test',
    embeddingModel: 'test-model', ontologyEnabled: false };
  let modelCalls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    modelCalls += 1;
    const inputs = (JSON.parse(String(init.body)) as { input: string[] }).input;
    return new Response(JSON.stringify({ data: inputs.map((_, index) => ({ index, embedding: [1, 0, 0] })) }));
  });
  for (const doc of documents) {
    const scope = { provider: 'lancedb', knowledgeBaseId: kb.id, documentId: doc.id };
    const bytes = Buffer.from(doc.content), version = identifyKnowledgeVersion(scope, bytes);
    const sourceSnapshot: KnowledgeSourceSnapshot = { ...scope, documentVersionId: version.documentVersionId,
      file: { blobId: version.sourceHash, sha256: version.sourceHash, sizeBytes: bytes.length },
      fileName: `${doc.id}.md`, origin: 'text', status: 'archived' };
    await ingestKnowledge({ kb, documentId: doc.id, title: doc.title, content: doc.content, sourceSnapshot });
  }
  const keywordOnly = { ...kb, embeddingModel: undefined, embeddingApiKey: undefined, embeddingBaseUrl: undefined };
  const beforeSearch = modelCalls;
  let found = 0, reciprocalRank = 0;
  for (const [label, query, expected] of cases) {
    const hits = await searchKnowledgeBase(keywordOnly, query, 3);
    const rank = hits.findIndex((hit) => hit.evidence?.documentId === expected) + 1;
    t.diagnostic(JSON.stringify({ label, query, expected, rank, actual: hits.map((hit) => hit.evidence?.documentId) }));
    assert.ok(rank > 0, `${label}: expected ${expected} in Top3`);
    found += 1; reciprocalRank += 1 / rank;
    for (const hit of hits) {
      assert.deepEqual(hit.retrieval?.channels, ['keyword']);
      assert.equal(hit.evidence?.verification, 'versioned');
      if (hit.evidence?.verification !== 'versioned') throw new Error('Missing evidence');
      const doc = documents.find((row) => row.id === hit.evidence?.documentId)!;
      const location = hit.evidence.sourceLocation!;
      assert.equal(hit.content, doc.content.slice(location.start, location.end));
      assert.equal(knowledgeContentHash(hit.content), hit.evidence.contentHash);
    }
  }
  t.diagnostic(JSON.stringify({ dataset: 'synthetic-keyword-v1', documents: documents.length, samples: cases.length,
    hitAt3: found / cases.length, mrrAt3: reciprocalRank / cases.length, semanticQuality: 'not evaluated' }));
  for (const query of ['', '   ', 'ZXQNOHIT999', '带薪休息']) {
    assert.deepEqual(await searchKnowledgeBase(keywordOnly, query, 3), [], `lexical boundary: ${query}`);
  }
  await deleteLocalKnowledgeDocument(kb, 'incident');
  assert.deepEqual(await searchKnowledgeBase(keywordOnly, 'ERR-AX904', 3), []);
  assert.equal((await searchKnowledgeBase(keywordOnly, '差旅报销', 3))[0].evidence?.documentId, 'travel');
  assert.equal(modelCalls, beforeSearch, 'keyword-only acceptance must not call embeddings');
});

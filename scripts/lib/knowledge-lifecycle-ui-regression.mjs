import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { knowledgeBinaryFixtures } from './knowledge-binary-fixtures.mjs';

export async function prepareKnowledgeLifecycleRegression(page, dataDir) {
  const ingestForm = page.locator('form').filter({ has: page.getByRole('heading', { name: '上传 / 导入文档', exact: true }) });
  let fail = false;
  let release;
  let gate;
  let calls = 0;
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/embeddings') {
        response.writeHead(404).end(); return;
      }
      const buffers = [];
      for await (const part of request) buffers.push(part);
      const input = JSON.parse(Buffer.concat(buffers).toString()).input;
      calls += 1;
      if (gate) await gate;
      response.setHeader('content-type', 'application/json');
      if (fail) { response.writeHead(400).end(JSON.stringify({ error: { message: 'fixture embedding unavailable' } })); return; }
      response.end(JSON.stringify({ data: (Array.isArray(input) ? input : [input]).map((_, index) => ({ index, embedding: [1, 0, 0] })) }));
    } catch { response.writeHead(500).end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const kb = { id: 'lifecycle', name: '全链路验收库', provider: 'lancedb', enabled: true, ontologyEnabled: false,
    embeddingModel: 'fixture-vector', embeddingApiKey: 'fixture-only',
    embeddingBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, updatedAt: Date.now() };
  const source = '# 星桥归档制度\r\n\r\n' + Array.from({ length: 5 }, (_, index) =>
    `第${index + 1}条 星桥归档凭证 ${'资料须经核验并由负责人确认，保留原始记录。'.repeat(34)}\r\n\r\n`).join('');
  const normalized = source.replace(/\r\n/g, '\n').trim();
  async function api(url, body, method = 'POST') {
    return page.evaluate(async ({ url, body, method }) => {
      const response = await fetch(url, { method, headers: { 'content-type': 'application/json',
        'x-workexpert-session': localStorage.getItem('auth.session.token') || '' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text();
      if (!response.ok) throw new Error(`${url}: ${response.status} ${text}`);
      return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
    }, { url, body, method });
  }
  async function openBase() {
    await page.getByRole('button', { name: '混合知识库', exact: true }).click();
    await page.locator('article').filter({ has: page.getByRole('heading', { name: kb.name, exact: true }) })
      .getByRole('button', { name: '管理知识', exact: true }).click();
  }
  async function search(query) {
    await page.getByRole('button', { name: /召回测试/ }).click();
    const ready = page.waitForResponse(r => /\/api\/knowledge\/(search|hybrid-search)$/.test(r.url()));
    await page.getByPlaceholder('输入查询…').fill(query);
    await page.getByRole('button', { name: '检索', exact: true }).click();
    const response = await ready, result = await response.json();
    assert.equal(response.ok(), true, JSON.stringify(result));
    await page.getByRole('button', { name: '检索', exact: true }).waitFor();
    return result.results;
  }
  async function submit() {
    const ready = page.waitForResponse('**/api/knowledge/ingest');
    await ingestForm.getByRole('button', { name: '写入索引', exact: true }).click();
    return ready;
  }
  async function verifyBinaryArchive(snapshot, fixture) {
    assert.equal(snapshot.origin, 'upload');
    assert.equal(snapshot.fileName, fixture.name);
    assert.equal(snapshot.file.sha256, createHash('sha256').update(fixture.buffer).digest('hex'));
    assert.equal(snapshot.file.sizeBytes, fixture.buffer.length);
    const downloaded = await page.evaluate(async version => {
      const response = await fetch(`/api/knowledge/sources/${version}`, {
        headers: { 'x-workexpert-session': localStorage.getItem('auth.session.token') || '' },
      });
      if (!response.ok) throw new Error(`Archive read failed: ${response.status}`);
      return Array.from(new Uint8Array(await response.arrayBuffer()));
    }, snapshot.documentVersionId);
    assert.deepEqual(Buffer.from(downloaded), fixture.buffer);
  }
  async function uploadBinary(fixture) {
    await page.getByRole('button', { name: '上传 / 导入文档', exact: true }).click();
    await ingestForm.locator('input[type=file]').setInputFiles({ name: fixture.name, mimeType: fixture.mimeType, buffer: fixture.buffer });
    const response = await submit();
    return { response, result: await response.json() };
  }
  return {
    async close() {
      release?.();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
    async run(dismissStartupDialogs, restartApi) {
      Object.assign(kb, (await api('/api/settings/knowledge/bases', [kb], 'PUT'))[0]);
      await page.reload();
      await dismissStartupDialogs();
      await openBase();
      await page.getByRole('button', { name: '上传 / 导入文档', exact: true }).click();
      await ingestForm.locator('input[type=file]').setInputFiles({ name: '星桥归档制度.md', mimeType: 'text/markdown', buffer: Buffer.from(source) });
      gate = new Promise(resolve => { release = resolve; });
      const submitted = submit();
      try {
        await page.getByText('正在处理文档', { exact: true }).waitFor();
        assert.equal(await page.getByText('文档已成功进入知识库', { exact: true }).count(), 0);
      } finally { release(); gate = undefined; }
      const response = await submitted, ingested = await response.json();
      assert.equal(response.ok(), true, JSON.stringify(ingested));
      assert.ok(ingested.chunks > 1);
      assert.equal(ingested.sourceSnapshot.status, 'archived');
      await page.getByText('文档已成功进入知识库', { exact: true }).waitFor();
      await page.getByRole('button', { name: '完成', exact: true }).click();
      const snapshotUrl = `/api/knowledge/sources/${ingested.sourceSnapshot.documentVersionId}`;
      assert.equal(await api(snapshotUrl, undefined, 'GET'), source);

      const hits = await search('星桥归档凭证');
      assert.ok(hits.some(hit => hit.retrieval?.channels.includes('keyword')));
      assert.ok(hits.some(hit => hit.retrieval?.channels.includes('vector')));
      for (const hit of hits) {
        assert.equal(hit.evidence.verification, 'versioned');
        const location = hit.evidence.sourceLocation;
        assert.equal(hit.content, normalized.slice(location.start, location.end));
        assert.equal(hit.evidence.contentHash, createHash('sha256').update(hit.content).digest('hex'));
      }
      assert.ok(hits.some(hit => hit.context));
      const context = page.locator('details').filter({ hasText: '查看上下文' }).first();
      assert.equal(await context.getAttribute('open'), null);
      await context.locator('summary').click();
      assert.equal(await context.locator('pre').isVisible(), true);
      assert.equal(await context.locator('pre').textContent(), hits.find(hit => hit.context).context.content);

      await page.getByRole('button', { name: /文档知识/ }).click();
      await page.getByRole('button', { name: '查看分片', exact: true }).click();
      await page.locator('li.cursor-pointer').first().click();
      await page.getByText(/解析文本偏移：.*非原文件页码/).waitFor();

      fail = true;
      const degraded = await search('星桥归档凭证');
      assert.ok(degraded.length > 0 && degraded.every(hit => hit.retrieval.degraded && hit.retrieval.channels.join() === 'keyword'));
      await page.getByText('本次使用降级检索', { exact: true }).waitFor();

      await page.getByRole('button', { name: '上传 / 导入文档', exact: true }).click();
      await page.getByRole('button', { name: '粘贴文本', exact: true }).click();
      await page.getByLabel('文档标题', { exact: true }).fill('保留文档');
      await ingestForm.locator('textarea').fill('独立保留标记 ZXKEEP731，采购审批资料。');
      const failed = await submit(), failure = await failed.json();
      assert.equal(failed.ok(), false);
      assert.equal(failure.sourceSnapshot.status, 'archived');
      await page.getByRole('alert').filter({ hasText: '导入失败' }).waitFor();
      assert.match(await ingestForm.locator('textarea').inputValue(), /ZXKEEP731/);
      const docs = await api('/api/knowledge/documents', { knowledgeBase: kb });
      assert.equal(docs.documents.some(doc => doc.id === failure.sourceSnapshot.documentId), false);
      const keywordOnly = { ...kb, embeddingModel: undefined, embeddingApiKey: undefined, embeddingBaseUrl: undefined };
      // Runtime now resolves saved configuration; request-body overrides intentionally cannot change it.
      await api('/api/settings/knowledge/bases', [keywordOnly], 'PUT');
      const failedSearch = await api('/api/knowledge/search', { knowledgeBase: keywordOnly, query: 'ZXKEEP731', topK: 6 });
      assert.deepEqual(failedSearch.results, [], 'failed ingestion must not publish the full-text index');
      await api('/api/settings/knowledge/bases', [kb], 'PUT');
      fail = false;
      const retried = await submit(), retry = await retried.json();
      assert.equal(retried.ok(), true, JSON.stringify(retry));
      await page.getByText('文档已成功进入知识库', { exact: true }).waitFor();
      await page.getByRole('button', { name: '完成', exact: true }).click();
      assert.equal((await api('/api/knowledge/documents', { knowledgeBase: kb })).documents.length, 2);

      await page.reload();
      await dismissStartupDialogs();
      await openBase();
      assert.ok((await search('星桥归档凭证')).some(hit => hit.evidence.documentId === ingested.documentId));
      await page.getByRole('button', { name: /文档知识/ }).click();
      let confirmation;
      page.once('dialog', async dialog => { confirmation = dialog.message(); await dialog.accept(); });
      const deleted = page.waitForResponse('**/api/knowledge/documents/delete');
      await page.locator('li').filter({ has: page.getByText('星桥归档制度', { exact: true }) })
        .getByRole('button', { name: '移除', exact: true }).click();
      assert.equal((await deleted).ok(), true);
      assert.match(confirmation, /原文快照会保留/);
      const afterDelete = await search('星桥归档凭证');
      assert.ok(afterDelete.every(hit => hit.evidence.documentId !== ingested.documentId && !hit.context?.content.includes('星桥归档凭证')));
      const kept = await search('ZXKEEP731');
      assert.ok(kept.some(hit => hit.evidence.documentId === retry.documentId && hit.retrieval.channels.includes('keyword')));
      assert.equal(await api(snapshotUrl, undefined, 'GET'), source);

      const binaryRecords = [];
      for (const fixture of knowledgeBinaryFixtures()) {
        const { response: uploaded, result } = await uploadBinary(fixture);
        assert.equal(uploaded.ok(), true, JSON.stringify(result));
        await page.getByText('文档已成功进入知识库', { exact: true }).waitFor();
        await page.getByRole('button', { name: '完成', exact: true }).click();
        await verifyBinaryArchive(result.sourceSnapshot, fixture);
        const matching = (await search(fixture.query)).find(hit => hit.evidence?.documentId === result.documentId);
        assert.ok(matching?.retrieval.channels.includes('keyword'), `${fixture.name} must match by keyword`);
        assert.ok(matching.content.includes(fixture.text));
        assert.equal(matching.evidence.documentVersionId, result.sourceSnapshot.documentVersionId);
        assert.equal(matching.evidence.contentHash, createHash('sha256').update(matching.content).digest('hex'));
        binaryRecords.push({ fixture, result });
      }

      const invalid = { name: '损坏样本.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from('BADBINARY764: not a valid ZIP archive') };
      const callsBeforeInvalid = calls;
      const { response: rejected, result: invalidResult } = await uploadBinary(invalid);
      assert.equal(rejected.ok(), false);
      await page.getByRole('alert').filter({ hasText: '导入失败' }).waitFor();
      await verifyBinaryArchive(invalidResult.sourceSnapshot, invalid);
      assert.equal(calls, callsBeforeInvalid, 'parse failure must occur before embedding');
      await ingestForm.getByRole('button', { name: '关闭', exact: true }).last().click();

      // A new API process must reconstruct state from disk, not the in-memory caches.
      await restartApi();
      await page.reload();
      await dismissStartupDialogs();
      await openBase();
      const persistedDocs = await api('/api/knowledge/documents', { knowledgeBase: kb });
      assert.equal(persistedDocs.documents.length, 3);
      for (const removedId of [ingested.documentId, failure.sourceSnapshot.documentId, invalidResult.sourceSnapshot.documentId]) {
        assert.ok(persistedDocs.documents.every(doc => doc.id !== removedId));
      }
      assert.ok((await search('ZXKEEP731')).some(hit => hit.evidence.documentId === retry.documentId && hit.retrieval.channels.includes('keyword')));
      for (const { fixture, result } of binaryRecords) {
        const restored = (await search(fixture.query)).find(hit => hit.evidence?.documentId === result.documentId);
        assert.ok(restored?.retrieval.channels.includes('keyword'));
        assert.equal(restored.evidence.documentVersionId, result.sourceSnapshot.documentVersionId);
        await verifyBinaryArchive(result.sourceSnapshot, fixture);
      }
      await api('/api/settings/knowledge/bases', [keywordOnly], 'PUT');
      for (const query of ['星桥归档凭证', 'BADBINARY764']) {
        const absent = await api('/api/knowledge/search', { knowledgeBase: keywordOnly, query, topK: 6 });
        const invisibleIds = [ingested.documentId, failure.sourceSnapshot.documentId, invalidResult.sourceSnapshot.documentId];
        assert.ok(absent.results.every(hit => !invisibleIds.includes(hit.evidence?.documentId)
          && !invisibleIds.includes(hit.context?.evidence.documentId)), 'deleted or failed documents must not return after process restart');
        // Chinese OR tokens may legitimately match "凭证" in the surviving DOCX.
        if (query === 'BADBINARY764') assert.deepEqual(absent.results, []);
      }
      assert.equal(await api(snapshotUrl, undefined, 'GET'), source);
      await verifyBinaryArchive(invalidResult.sourceSnapshot, invalid);
      assert.ok(calls > 0);
      console.log('[knowledge-lifecycle] KE-E01–E06: real APIs, archive, FTS/vector, context, offsets, failure/retry, PDF/DOCX, deletion and API process restart: PASS');
    },
  };
}

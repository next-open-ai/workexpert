import assert from 'node:assert/strict';

// UI protocol fixtures only: real ingestion and retrieval are covered separately.
export async function prepareKnowledgeSearchRegression(page) {
  const pending = new Map();
  const requests = [];
  await page.route('**/api/settings/knowledge/bases', route => route.fulfill({ json: ['A', 'B'].map(id => ({
    id, name: `验收知识库${id}`, provider: 'lancedb', enabled: true, ontologyEnabled: id === 'B', updatedAt: 1,
    ...(id === 'B' ? { indexState: { status: 'stale' } } : {}),
  })) }));
  await page.route('**/api/knowledge/documents', route => route.fulfill({ json: {
    ok: true, backend: 'lancedb', documents: [], documentCount: 0, chunkCount: 0,
  } }));
  await page.route(/\/api\/knowledge\/(search|hybrid-search)$/, async route => {
    const input = route.request().postDataJSON();
    requests.push(input);
    pending.set(input.query, route);
  });
  async function waitPending(query) {
    const deadline = Date.now() + 5000;
    while (!pending.has(query)) {
      if (Date.now() > deadline) throw new Error(`Missing search request: ${query}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  async function settle(query, { channels = ['keyword'], degraded = false, error = false, empty = false, ontology = false, ontologyHit = false } = {}) {
    await waitPending(query);
    const route = pending.get(query);
    pending.delete(query);
    const response = page.waitForResponse(r => r.request().postDataJSON()?.query === query);
    await route.fulfill({ status: error ? 500 : 200, json: error ? { message: `旧错误-${query}` } : {
      ok: true, strategy: ontology ? 'ontology-enhanced' : 'hybrid', results: empty ? [] : [{
        id: query, title: `结果-${query}`, content: `正文-${query}`, score: 0.7,
        retrieval: { channels, ranking: 'rrf', degraded },
        retrievalRoutes: ontologyHit ? ['ontology-vector'] : ['raw-vector'],
        context: { content: '补充上下文验收', matchedChunkIds: [query], evidence: {
          schemaVersion: 1, verification: 'versioned', provider: 'lancedb', knowledgeBaseId: 'fixture',
          documentId: 'fixture-document', documentVersionId: `dv-${'1'.repeat(64)}`,
          processingRevisionId: `pr-${'2'.repeat(64)}`, chunkId: `ch-${'3'.repeat(64)}`, contentHash: '4'.repeat(64),
        } },
      }],
    } });
    await response;
    // Let fetch body parsing and Vue's render queue finish before negative assertions.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function open(id) {
    const back = page.getByRole('button', { name: '返回列表', exact: true });
    if (await back.isVisible()) await back.click();
    await page.locator('article').filter({ has: page.getByRole('heading', { name: `验收知识库${id}`, exact: true }) })
      .getByRole('button', { name: '管理知识', exact: true }).click();
    await page.getByRole('button', { name: '查看测试与报告', exact: true }).click();
  }
  async function start(query) {
    const input = page.getByPlaceholder('输入查询…');
    await input.fill(query);
    await input.press('Enter');
    await waitPending(query);
  }
  function noText(text) { return page.getByText(text).count().then(count => assert.equal(count, 0, text)); }
  return async () => {
    await page.getByRole('button', { name: '混合知识库', exact: true }).click();
    await page.getByRole('button', { name: '知识库设置', exact: true }).first().waitFor();
    await open('A');
    await page.getByText('输入实际问题或关键词，检查能否找到需要的内容。', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: '检索问题或关键词', exact: true }).fill('短');
    await page.getByRole('button', { name: '检索', exact: true }).click();
    await page.getByText('请输入至少 2 个字符的问题或关键词。', { exact: true }).waitFor();
    assert.equal(requests.length, 0);
    const settings = page.locator('details').filter({ has: page.locator('summary').getByText('检索设置', { exact: true }) });
    assert.equal(await settings.getAttribute('open'), null);
    await settings.locator('summary').click();
    await settings.getByText('关键词 + 语义', { exact: true }).waitFor();
    await settings.locator('summary').click();
    await start('重复查询');
    await page.getByPlaceholder('输入查询…').press('Enter');
    await page.getByPlaceholder('输入查询…').press('Enter');
    await page.waitForTimeout(100);
    assert.equal(requests.filter(r => r.query === '重复查询').length, 1);

    await start('新查询');
    await settle('重复查询');
    assert.equal(await page.getByRole('button', { name: '检索中…', exact: true }).isDisabled(), true);
    await noText('结果-重复查询');
    await settle('新查询');
    await page.getByText('结果-新查询', { exact: true }).waitFor();
    await page.getByText('本次匹配来自关键词检索', { exact: true }).waitFor();
    const diagnostic = page.locator('details').filter({ has: page.locator('summary').getByText('检索详情', { exact: true }) });
    assert.equal(await diagnostic.getAttribute('open'), null);
    assert.equal(await page.getByText(/排序分 0.700/).isVisible(), false);
    await diagnostic.locator('summary').focus();
    await page.keyboard.press('Enter');
    await page.getByText(/排序分 0.700/).waitFor();
    await diagnostic.locator('summary').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTitle('收起侧栏', { exact: true }).click();
    const searchPanel = page.locator('article').filter({ has: page.getByRole('textbox', { name: '检索问题或关键词', exact: true }) });
    await page.getByRole('textbox', { name: '检索问题或关键词', exact: true }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(250); // Wait for the existing sidebar width transition.
    assert.equal(await searchPanel.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= window.innerWidth), true);
    if (process.env.WORKEXPERT_KNOWLEDGE_SCREENSHOT) await page.screenshot({ path: process.env.WORKEXPERT_KNOWLEDGE_SCREENSHOT, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByTitle('展开侧栏', { exact: true }).click();
    const details = page.locator('details').filter({ hasText: '查看上下文' });
    assert.equal(await details.getAttribute('open'), null);
    await details.locator('summary').click();
    assert.equal(await page.getByText('补充上下文验收', { exact: true }).isVisible(), true);

    await start('旧库成功');
    await open('B');
    await page.getByText('索引待重建', { exact: true }).waitFor();
    await noText('索引就绪');
    await start('新库查询');
    await settle('旧库成功');
    await noText('结果-旧库成功');
    assert.equal(await page.getByRole('button', { name: '检索中…', exact: true }).isDisabled(), true);
    await settle('新库查询', { channels: ['keyword', 'vector'], ontology: true });
    await page.getByText('本次匹配来自关键词与语义检索', { exact: true }).waitFor();
    await noText('本次结果包含本体增强匹配');
    await start('本体实际命中');
    await settle('本体实际命中', { ontology: true, ontologyHit: true });
    await page.getByText('本次结果包含本体增强匹配', { exact: true }).waitFor();

    await start('旧库失败');
    await open('A');
    await start('双路查询');
    await settle('旧库失败', { error: true });
    await noText('旧错误-旧库失败');
    assert.equal(await page.getByRole('button', { name: '检索中…', exact: true }).isDisabled(), true);
    await settle('双路查询', { channels: ['keyword', 'vector'] });
    await page.getByText('本次匹配来自关键词与语义检索', { exact: true }).waitFor();

    await start('返回同库');
    await open('A');
    await settle('返回同库');
    await noText('结果-返回同库');
    assert.equal(await page.getByRole('button', { name: '检索', exact: true }).isEnabled(), true);

    await start('降级查询');
    await settle('降级查询', { degraded: true });
    await page.getByText('本次使用降级检索', { exact: true }).waitFor();
    await start('空查询结果');
    await settle('空查询结果', { empty: true });
    await page.getByText('未找到匹配结果', { exact: true }).waitFor();
    await noText('结果-降级查询');
    await start('当前失败');
    await settle('当前失败', { error: true });
    await page.getByText('旧错误-当前失败').waitFor();
    await page.getByText('检索失败', { exact: true }).waitFor();
    await page.getByText('检索暂未完成，请检查知识库设置或稍后重试。', { exact: true }).waitFor();
    await noText('未找到匹配结果');
    assert.equal(await page.getByRole('button', { name: '检索', exact: true }).isEnabled(), true);

    await start('报告快照');
    await settle('报告快照');
    const countBeforeReport = requests.length;
    const evaluation = page.locator('details').filter({ has: page.locator('summary').getByText('离线评测报告', { exact: true }) });
    assert.equal(await evaluation.getAttribute('open'), null);
    await evaluation.locator('summary').first().click();
    const panel = page.getByRole('region', { name: '离线评测报告', exact: true });
    const snapshotDownload = page.waitForEvent('download');
    await panel.getByRole('button', { name: '导出当前召回快照', exact: true }).click();
    const snapshotFile = await snapshotDownload;
    const stream = await snapshotFile.createReadStream();
    const parts = []; for await (const part of stream) parts.push(part);
    const data = JSON.parse(Buffer.concat(parts).toString());
    assert.equal(data.cases[0].relevantGroups, null);
    assert.deepEqual(data.cases[0].runs[0].hits, [{ id: 'chunk:报告快照', title: '结果-报告快照' }]);
    const fileInput = panel.getByLabel('选择标注文件并生成报告', { exact: true });
    const upload = value => fileInput.setInputFiles({ name: 'evaluation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    await upload(data);
    await panel.getByRole('alert').filter({ hasText: '未标注' }).waitFor();
    data.cases[0].relevantGroups = [['chunk:报告快照']];
    data.snapshot = '测试快照（无模型调用）';
    await upload(data);
    await panel.getByRole('heading', { name: '评测报告 · Top 6 · 1 题' }).waitFor();
    const htmlDownload = page.waitForEvent('download');
    await panel.getByRole('button', { name: '下载 HTML 报告', exact: true }).click();
    assert.equal((await htmlDownload).suggestedFilename(), 'retrieval-evaluation.html');
    if (process.env.WORKEXPERT_EVALUATION_SCREENSHOT) await panel.screenshot({ path: process.env.WORKEXPERT_EVALUATION_SCREENSHOT });
    await upload({ ...data, knowledgeBaseId: 'B' });
    await panel.getByRole('alert').filter({ hasText: '当前知识库' }).waitFor();
    assert.equal(await panel.getByRole('button', { name: '下载 HTML 报告' }).count(), 0);
    assert.equal(requests.length, countBeforeReport, 'offline report must not issue searches');
    console.log('[knowledge-ui] KEV-TEST-01: lazy offline report, snapshot/download, validation, stale report clearing, zero extra searches: PASS');

    await start('离开页面');
    await page.getByRole('button', { name: '资产库', exact: true }).click();
    await settle('离开页面', { error: true });
    await noText('旧错误-离开页面');
    console.log('[knowledge-ui] KE-U01/U02 + WK-U08: stale requests, settings, states, actual routes, keyboard diagnostics, narrow layout and context: PASS');
  };
}

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runWikiEditingRegression } from './wiki-editing-ui-regression.mjs';

/** Real browser/API/storage and Pi adapter; only the external model/embedding provider is replaced. */
export async function prepareWikiRegression(page) {
  let calls = 0;
  let truncate = false;
  const provider = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const payload = JSON.parse(raw);
      if (req.url === '/v1/embeddings') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: (Array.isArray(payload.input) ? payload.input : [payload.input]).map((_, index) => ({ index, embedding: [1, 0, 0] })) })); return;
      }
      assert.equal(req.url, '/v1/chat/completions'); calls++;
      if (calls === 1) await new Promise(resolve => setTimeout(resolve, 4000));
      assert.notEqual(payload.enable_search, true); assert.ok(!payload.tools?.length);
      const userContent = payload.messages.findLast((m) => m.role === 'user').content;
      const input = JSON.parse(typeof userContent === 'string' ? userContent : userContent.filter((part) => part.type === 'text').map((part) => part.text).join('\n'));
      const chunkIds = input.flatMap((document) => document.chunks.map((chunk) => chunk.chunkId));
      assert.ok(chunkIds.every(id => /^source_\d+$/.test(id)), 'model sees short reference IDs only');
      const output = { pages: [1, 2].map((n) => ({ key: `p${n}`, title: n === 1 ? '星桥报销' : '发票规范', aliases: n === 1 ? ['差旅费用'] : [],
        summary: '核对发票后报销', sections: [{ heading: '办理要求',
          body: n === 1 ? '星桥报销必须提供发票。<img src="https://wiki-invalid.example/pixel" onerror="window.wikiUnsafe=true">' : '发票必须真实有效。',
          chunkIds, relatedKeys: [`p${3 - n}`] }, ...(n === 2 ? [{ heading: '再次核验', body: '发票应真实有效，报销前核对。', chunkIds, relatedKeys: [] }] : [])] })) };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const event = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'wiki-test', object: 'chat.completion.chunk',
        created: 1, model: payload.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      res.write(event({ role: 'assistant', content: `\`\`\`json\n${JSON.stringify(output)}\n\`\`\`` }));
      res.end(event({}, truncate ? 'length' : 'stop') + 'data: [DONE]\n\n');
    } catch (error) { console.error('[wiki-fixture]', error); res.writeHead(500).end(JSON.stringify({ error: { message: String(error) } })); }
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
  async function api(url, body, method = 'POST') {
    return page.evaluate(async ({ url, body, method }) => {
      const response = await fetch(url, { method, headers: { 'content-type': 'application/json',
        'x-workexpert-session': localStorage.getItem('auth.session.token') || '' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text(); if (!response.ok) throw new Error(`${response.status}: ${text}`);
      return JSON.parse(text);
    }, { url, body, method });
  }
  const kb = { id: 'wiki-e2e', name: 'Wiki 闭环验收库', provider: 'lancedb', enabled: true, ontologyEnabled: false,
    embeddingModel: 'fixture-vector', embeddingApiKey: 'fixture-only', embeddingBaseUrl: baseUrl, updatedAt: Date.now() };
  return {
    async close() { provider.closeAllConnections(); await new Promise((resolve) => provider.close(resolve)); },
    async run(dismiss, restart) {
      await api('/api/settings/knowledge/bases', [kb], 'PUT');
      await api('/api/settings/model', { version: 3, providerInstances: [{ id: 'wiki-provider', type: 'openai-compatible',
        name: '本地测试模型', baseUrl, apiKey: 'fixture-only', disableThinking: true }],
      models: [{ id: 'wiki-model', providerInstanceId: 'wiki-provider', capability: 'chat', modelId: 'wiki-fixture' },
        { id: 'wiki-embedding', providerInstanceId: 'wiki-provider', capability: 'embedding', modelId: 'fixture-vector', meta: { dimension: 3, maxBatch: 32, maxInputChars: 8000, normalize: false } }],
      activeChatModelId: 'wiki-model', activeEmbeddingModelId: 'wiki-embedding', employeeDefaultModelIds: {}, capabilityBindings: [], agentCapabilityAssignments: [] }, 'PUT');
      const ingested = await api('/api/knowledge/ingest', { knowledgeBase: kb, title: '差旅制度', content: '# 差旅\n\n星桥报销必须提供发票，发票必须真实有效。' });
      assert.ok(ingested.sourceSnapshot);
      await page.reload(); await dismiss();
      const open = async (manage = false) => {
        await page.getByRole('button', { name: '混合知识库', exact: true }).click();
        const back = page.getByRole('button', { name: '返回列表', exact: true });
        if (await back.isVisible()) await back.click();
        const card = page.locator('article').filter({ has: page.getByRole('heading', { name: kb.name, exact: true }) });
        await card.getByRole('button', { name: manage ? '管理知识' : '打开 Wiki', exact: true }).click();
        if (manage) await page.getByRole('button', { name: /W Wiki 整理主题/ }).click();
      };
      await open(true);
      const wiki = page.getByRole('region', { name: 'Wiki 知识库' });
      await wiki.getByText('暂无已发布页面。先生成草稿，核对后发布。', { exact: true }).waitFor();
      await wiki.getByRole('button', { name: '生成 Wiki', exact: true }).click();
      await wiki.getByRole('checkbox', { name: '差旅制度', exact: true }).check();
      await wiki.getByRole('button', { name: '开始生成（1 份）', exact: true }).click();
      const progress = wiki.getByRole('region', { name: 'Wiki 生成进度' });
      await progress.getByText(/模型正在阅读资料/).waitFor();
      assert.equal(await progress.getByRole('progressbar').getAttribute('aria-valuenow'), '0');
      await progress.getByText(/已等待/).waitFor();
      await progress.getByRole('button', { name: '取消生成', exact: true }).waitFor();
      if (process.env.WORKEXPERT_WIKI_PROGRESS_SCREENSHOT) await progress.screenshot({ path: process.env.WORKEXPERT_WIKI_PROGRESS_SCREENSHOT });
      try { await wiki.getByText(/草稿已生成，请核对后发布/).waitFor({ timeout: 20000 }); }
      catch (error) { console.error('[wiki-ui] generation state', await wiki.innerText(), await api('/api/knowledge/wiki-e2e/wiki/generation-jobs', undefined, 'GET')); throw error; }
      assert.equal(await progress.getByRole('progressbar').getAttribute('aria-valuenow'), '100');
      assert.equal(await progress.locator('.generation-shimmer').count(), 0);
      assert.equal(calls, 1);
      const jobs = await api('/api/knowledge/wiki-e2e/wiki/generation-jobs', undefined, 'GET');
      assert.equal(jobs.items[0].state, 'completed'); assert.equal(jobs.items[0].pageIds.length, 2);
      const ids = jobs.items[0].pageIds;
      assert.equal((await api('/api/knowledge/wiki-e2e/wiki/search?query=星桥', undefined, 'GET')).items.length, 0);
      await wiki.getByRole('region', { name: 'Wiki 草稿目录' }).getByRole('button', { name: '预览草稿：星桥报销', exact: true }).click();
      await wiki.locator('article h2').getByText('星桥报销', { exact: true }).waitFor();
      await wiki.getByRole('button', { name: '← 返回草稿目录', exact: true }).click();
      await wiki.getByRole('button', { name: 'Wiki 首页', exact: true }).click();
      await wiki.getByRole('region', { name: 'Wiki 首页目录' }).getByText(/首页暂无可阅读内容/).waitFor();
      await wiki.getByRole('button', { name: '待发布草稿', exact: true }).click();
      let external = 0; page.on('request', (req) => { if (req.url().includes('wiki-invalid.example')) external++; });
      await wiki.getByRole('navigation', { name: 'Wiki 页面目录' }).getByRole('button', { name: /星桥报销/ }).click();
      await wiki.locator('summary').getByText('查看本节来源', { exact: true }).click();
      await wiki.getByText(/星桥报销必须提供发票，发票必须真实有效/).waitFor();
      assert.equal(await wiki.locator('img').count(), 0); assert.equal(await page.evaluate(() => window.wikiUnsafe), undefined); assert.equal(external, 0);
      const download = page.waitForEvent('download'); await wiki.getByRole('button', { name: '下载原文件' }).click();
      assert.equal((await download).suggestedFilename(), '差旅制度.txt');
      // WK-U06: use real pagination with one item per page, including a failed collection.
      const draftPattern = '**/wiki/pages?view=drafts&*';
      let failPagination = true, publishRequests = 0;
      const recordPublish = request => { if (request.url().endsWith('/publish')) publishRequests++; };
      page.on('request', recordPublish);
      await page.route(draftPattern, async route => {
        const url = new URL(route.request().url());
        if (failPagination && url.searchParams.has('afterPageId')) return route.abort();
        url.searchParams.set('limit', '1');
        await route.continue({ url: url.toString() });
      });
      await wiki.getByRole('button', { name: '全部发布', exact: true }).click();
      await wiki.getByRole('alert').waitFor();
      assert.equal(publishRequests, 0);
      failPagination = false;
      await wiki.getByRole('button', { name: '待发布草稿', exact: true }).click();
      await wiki.getByRole('button', { name: '更多页面', exact: true }).waitFor();
      await wiki.getByRole('button', { name: '全选全部草稿', exact: true }).click();
      await wiki.getByRole('button', { name: '发布所选（2 页）', exact: true }).waitFor();
      assert.equal(await wiki.getByRole('checkbox', { name: /^选择 / }).count(), 2);
      await wiki.getByRole('checkbox', { name: '选择 发票规范', exact: true }).uncheck();
      await wiki.getByRole('button', { name: '发布所选（1 页）', exact: true }).waitFor();
      await wiki.getByRole('checkbox', { name: '选择 发票规范', exact: true }).check();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.setViewportSize({ width: 1440, height: 1000 });
      page.once('dialog', dialog => dialog.dismiss());
      await wiki.getByRole('button', { name: '发布所选（2 页）', exact: true }).click();
      assert.equal(publishRequests, 0);
      // A revision changed after selection must not be silently promoted.
      const changed = await api(`/api/knowledge/wiki-e2e/wiki/pages/${ids[1]}?view=drafts`, undefined, 'GET');
      await api(`/api/knowledge/wiki-e2e/wiki/pages/${ids[1]}/draft`, {
        baseGeneration: changed.page.generation, slug: changed.page.slug,
        content: { ...changed.revision.content, summary: '已更新，需重新核对' }, idempotencyKey: 'bulk-conflict',
      }, 'PUT');
      page.once('dialog', dialog => dialog.accept());
      await wiki.getByRole('button', { name: '发布所选（2 页）', exact: true }).click();
      await wiki.getByText('发布完成：成功 1 页，失败 1 页。', { exact: true }).waitFor();
      await wiki.getByRole('list', { name: '发布失败页面' }).getByText(/页面已变化/).waitFor();
      assert.equal(publishRequests, 1);
      assert.equal((await api(`/api/knowledge/wiki-e2e/wiki/pages/${ids[1]}?view=drafts`, undefined, 'GET')).page.publishedRevisionId, null);
      await wiki.getByRole('button', { name: '取消全选', exact: true }).click();
      await wiki.getByRole('button', { name: '发布所选（0 页）', exact: true }).waitFor();
      page.once('dialog', dialog => dialog.accept());
      await wiki.getByRole('button', { name: '全部发布', exact: true }).click();
      await wiki.getByText('发布完成：成功 1 页，失败 0 页。', { exact: true }).waitFor();
      await wiki.getByText('暂无草稿，选择资料生成 Wiki。', { exact: true }).waitFor();
      assert.equal(publishRequests, 2);
      page.off('request', recordPublish);
      await page.unroute(draftPattern);
      console.log('[wiki-ui] WK-U06 pagination/select-all/cancel/CAS/partial/all-publish: PASS');
      await wiki.getByRole('button', { name: 'Wiki 首页', exact: true }).click();
      const home = wiki.getByRole('region', { name: 'Wiki 首页目录' });
      await home.getByRole('button', { name: '阅读主题：星桥报销', exact: true }).waitFor();
      if (process.env.WORKEXPERT_WIKI_HOME_SCREENSHOT) await home.screenshot({ path: process.env.WORKEXPERT_WIKI_HOME_SCREENSHOT });
      await home.getByRole('button', { name: '阅读主题：星桥报销', exact: true }).click();
      await wiki.locator('article h2').getByText('星桥报销', { exact: true }).waitFor();
      await wiki.locator('article').getByRole('button', { name: '发票规范', exact: true }).first().click();
      await wiki.locator('article h2').getByText('发票规范', { exact: true }).waitFor();
      await wiki.getByRole('button', { name: '← 返回Wiki 首页', exact: true }).click();
      await home.getByRole('button', { name: '阅读主题：星桥报销', exact: true }).waitFor();
      console.log('[wiki-ui] WK-H-T01 home, draft isolation, topic reading, links and return: PASS');
      const readingOpened = page.waitForEvent('popup');
      await wiki.getByRole('button', { name: '打开 Wiki 网页', exact: true }).click();
      const reader = await readingOpened;
      await reader.getByRole('link', { name: /星桥报销.*开始阅读/ }).waitFor();
      assert.equal(await reader.locator('article:visible').count(), 0);
      await reader.getByRole('link', { name: /星桥报销.*开始阅读/ }).click();
      await reader.getByRole('heading', { name: '星桥报销', exact: true }).waitFor();
      assert.equal(await reader.locator('article:visible').count(), 1);
      assert.equal(await reader.locator('.grid:visible').count(), 0);
      await reader.locator('article:visible').getByRole('link', { name: '发票规范 →', exact: true }).click();
      await reader.getByRole('heading', { name: '发票规范', exact: true }).waitFor();
      await reader.goBack();
      await reader.getByRole('heading', { name: '星桥报销', exact: true }).waitFor();
      await reader.getByRole('link', { name: '← 返回首页', exact: true }).click();
      await reader.getByRole('link', { name: /星桥报销.*开始阅读/ }).waitFor();
      assert.equal(await reader.locator('article:visible').count(), 0);
      await reader.close();
      assert.equal(page.isClosed(), false);
      const opened = page.waitForEvent('popup');
      await wiki.getByRole('button', { name: '在外部浏览器打开', exact: true }).click();
      const browserReader = await opened;
      await browserReader.getByRole('link', { name: /星桥报销.*开始阅读/ }).waitFor();
      assert.equal(await browserReader.locator('article:visible').count(), 0);
      if (process.env.WORKEXPERT_WIKI_READER_SCREENSHOT) await browserReader.screenshot({ path: process.env.WORKEXPERT_WIKI_READER_SCREENSHOT });
      await browserReader.close();
      console.log('[wiki-ui] WK-R16-T independent reader, home-only, topic routing, backlinks/history and close isolation: PASS');
      // WK-U07: real settings persistence and authenticated multi-route HTTP/UI recall.
      const setWikiRecall = async enabled => {
        await page.getByRole('button', { name: '混合知识库', exact: true }).click();
        const back = page.getByRole('button', { name: '返回列表', exact: true });
        if (await back.isVisible()) await back.click();
        const card = page.locator('article').filter({ has: page.getByRole('heading', { name: kb.name, exact: true }) });
        if (process.env.WORKEXPERT_KNOWLEDGE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.WORKEXPERT_KNOWLEDGE_SCREENSHOT_DIR}/knowledge-list.png`, fullPage: true });
        await card.getByRole('button', { name: '知识库设置', exact: true }).click();
        const toggle = page.getByRole('checkbox', { name: '启用 Wiki 融合检索', exact: true });
        const expansion = page.getByRole('checkbox', { name: '关联页面扩展', exact: true });
        if (enabled) assert.equal(await expansion.isChecked(), false);
        await toggle.setChecked(enabled);
        if (enabled) await expansion.check();
        else assert.equal(await expansion.isDisabled(), true);
        const form = page.locator('form').filter({ has: toggle });
        if (process.env.WORKEXPERT_KNOWLEDGE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.WORKEXPERT_KNOWLEDGE_SCREENSHOT_DIR}/knowledge-settings.png`, fullPage: true });
        await form.getByRole('button', { name: '保存', exact: true }).click();
        await form.waitFor({ state: 'hidden' });
        const configs = await api('/api/settings/knowledge/bases', undefined, 'GET');
        assert.equal(configs.find(item => item.id === kb.id).wikiRetrievalEnabled, enabled);
        assert.equal(configs.find(item => item.id === kb.id).wikiRelatedExpansionEnabled, true);
      };
      await setWikiRecall(true);
      await page.reload(); await dismiss();
      await page.getByRole('button', { name: '混合知识库', exact: true }).click();
      const recallCard = page.locator('article').filter({ has: page.getByRole('heading', { name: kb.name, exact: true }) });
      await recallCard.getByRole('button', { name: '知识库设置', exact: true }).click();
      assert.equal(await page.getByRole('checkbox', { name: '启用 Wiki 融合检索', exact: true }).isChecked(), true);
      assert.equal(await page.getByRole('checkbox', { name: '关联页面扩展', exact: true }).isChecked(), true);
      await page.locator('form').filter({ has: page.getByRole('checkbox', { name: '启用 Wiki 融合检索', exact: true }) }).getByRole('button', { name: '关闭', exact: true }).click();
      await recallCard.getByRole('button', { name: '管理知识', exact: true }).click();
      await page.getByRole('button', { name: /召回测试/ }).click();
      await page.getByPlaceholder('输入查询…', { exact: true }).fill('差旅费用');
      await page.getByRole('button', { name: '检索', exact: true }).click();
      await page.getByText('Wiki 整理', { exact: true }).first().waitFor();
      assert.equal(await page.getByText(/Wiki 是带原文引用的整理内容/).count(), 1);
      assert.equal(await page.getByText(/排序分/).first().isVisible(), false);
      // WK-U08: saving the current library must invalidate already displayed results.
      await page.getByRole('button', { name: '知识库设置', exact: true }).click();
      const currentSettings = page.getByRole('dialog', { name: '知识库设置', exact: true });
      await currentSettings.getByRole('button', { name: '保存', exact: true }).click();
      await currentSettings.waitFor({ state: 'hidden' });
      assert.equal(await page.getByText('Wiki 整理', { exact: true }).count(), 0);
      await page.getByText('输入实际问题或关键词，检查能否找到需要的内容。', { exact: true }).waitFor();
      await page.getByRole('button', { name: '检索', exact: true }).click();
      await page.getByText('Wiki 整理', { exact: true }).first().waitFor();
      if (process.env.WORKEXPERT_KNOWLEDGE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.WORKEXPERT_KNOWLEDGE_SCREENSHOT_DIR}/knowledge-search.png`, fullPage: true });
      await page.getByRole('button', { name: '查看 Wiki 与来源', exact: true }).first().click();
      await wiki.getByRole('heading', { name: '星桥报销', exact: true }).waitFor();
      const enabledResult = await api('/api/knowledge/search', { knowledgeBase: kb, query: '差旅费用', topK: 5 });
      assert.ok(enabledResult.results.some(hit => hit.wiki?.pageId));
      assert.ok(enabledResult.results.filter(hit => hit.wiki).every(hit => !hit.evidence && !hit.context));
      await setWikiRecall(false);
      const disabledResult = await api('/api/knowledge/search', { knowledgeBase: { ...kb, wikiRetrievalEnabled: true }, query: '差旅费用', topK: 5 });
      assert.ok(disabledResult.results.every(hit => !hit.wiki), 'client cannot override saved switch');
      assert.equal((await api('/api/knowledge/wiki-e2e/wiki/search?query=差旅费用', undefined, 'GET')).items.length, 1);
      await open();
      console.log('[wiki-ui] WK-U07 persisted independent switch, fused Wiki identity, page/source navigation and disabled isolation: PASS');
      await wiki.getByRole('textbox', { name: '搜索 Wiki' }).fill('差旅费用'); await wiki.getByRole('button', { name: '搜索', exact: true }).click();
      await wiki.getByRole('navigation', { name: 'Wiki 页面目录' }).getByRole('button', { name: /星桥报销/ }).click();
      await wiki.locator('article').getByRole('button', { name: '发票规范', exact: true }).first().click();
      await wiki.getByRole('heading', { name: '发票规范', exact: true }).waitFor();
      const directory = wiki.getByRole('navigation', { name: 'Wiki 页面目录' });
      // Return to the directory so the linked page is also a visible navigation entry.
      await wiki.getByRole('button', { name: '已发布', exact: true }).click();
      const pageButton = directory.getByRole('button', { name: /发票规范/ });
      await pageButton.click();
      const outline = directory.getByRole('list', { name: '发票规范的章节' });
      await outline.getByRole('button', { name: '再次核验', exact: true }).click();
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), '再次核验');
      assert.equal(await pageButton.getAttribute('aria-expanded'), 'true');
      const revisionRequests = [];
      const recordRead = (request) => { if (/\/wiki\/pages\/[^/?]+\?view=/.test(request.url())) revisionRequests.push(request.url()); };
      page.on('request', recordRead);
      await pageButton.click(); assert.equal(await outline.count(), 0);
      await pageButton.click(); await outline.waitFor();
      page.off('request', recordRead); assert.equal(revisionRequests.length, 0);
      // Real API pagination with a one-page limit; no response data is mocked.
      const pageListPattern = /\/api\/knowledge\/wiki-e2e\/wiki\/pages\?/;
      await page.route(pageListPattern, (route) => { const url = new URL(route.request().url()); url.searchParams.set('limit', '1'); return route.continue({ url: url.toString() }); });
      await wiki.getByRole('button', { name: '已发布', exact: true }).click();
      await directory.getByRole('button', { name: '更多页面', exact: true }).waitFor();
      await directory.locator('ul > li > button').first().click();
      const readingTitle = await wiki.locator('article h2').innerText();
      await directory.getByRole('button', { name: '更多页面', exact: true }).click();
      await directory.locator(':scope > ul > li > button').nth(1).waitFor();
      assert.equal(await wiki.locator('article h2').innerText(), readingTitle);
      // The existing cursor signals exhaustion on the next empty page when a page is exactly full.
      await directory.getByRole('button', { name: '更多页面', exact: true }).click();
      await directory.getByRole('button', { name: '更多页面', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(await wiki.locator('article h2').innerText(), readingTitle);
      await page.unroute(pageListPattern);
      await directory.getByRole('button', { name: /发票规范/ }).click();
      if (process.env.WORKEXPERT_WIKI_SCREENSHOT) {
        await wiki.getByRole('button', { name: '已发布', exact: true }).click();
        await wiki.getByRole('navigation', { name: 'Wiki 页面目录' }).getByRole('button', { name: /发票规范/ }).click();
        await wiki.getByRole('heading', { name: '发票规范', exact: true }).waitFor();
        await wiki.screenshot({ path: process.env.WORKEXPERT_WIKI_SCREENSHOT });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await directory.getByRole('button', { name: /发票规范/ }).click();
      if (!(await directory.getByRole('button', { name: '再次核验', exact: true }).count())) await directory.getByRole('button', { name: /发票规范/ }).click();
      await directory.getByRole('button', { name: '再次核验', exact: true }).click();
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), '再次核验');
      await page.setViewportSize({ width: 1440, height: 1000 });
      await runWikiEditingRegression(page, wiki, api, ids[1]);
      await restart(); await page.reload(); await dismiss(); await open();
      assert.equal((await api('/api/knowledge/wiki-e2e/wiki/search?query=发票', undefined, 'GET')).items.length, 2);
      await api('/api/knowledge/documents/delete', { knowledgeBase: kb, documentId: ingested.sourceSnapshot.documentId });
      assert.equal((await api('/api/knowledge/wiki-e2e/wiki/search?query=发票', undefined, 'GET')).items.length, 0);
      assert.equal((await api('/api/knowledge/wiki-e2e/wiki/pages', undefined, 'GET')).items.length, 0);
      assert.equal(ids.length, 2); assert.equal(calls, 1);
      const longContent = Array.from({ length: 120 }, (_, i) => `## 第${i + 1}章\n\n${'报销需要真实发票，核对费用及日期。'.repeat(35)}`).join('\n\n');
      await api('/api/knowledge/ingest', { knowledgeBase: kb, title: '长文制度', content: longContent });
      await page.reload(); await dismiss(); await open();
      truncate = true;
      const callsBeforeFailure = calls;
      await wiki.getByRole('button', { name: '生成 Wiki', exact: true }).click();
      await wiki.getByRole('checkbox', { name: '长文制度', exact: true }).check();
      await wiki.getByRole('button', { name: '开始生成（1 份）', exact: true }).click();
      await wiki.getByText('模型输出达到长度上限，结果不完整。请减少所选资料或更换模型后重新生成。', { exact: true }).waitFor({ timeout: 30000 });
      const failedJob = (await api('/api/knowledge/wiki-e2e/wiki/generation-jobs', undefined, 'GET')).items[0];
      assert.equal(failedJob.errorCode, 'MODEL_OUTPUT_TRUNCATED'); assert.deepEqual(failedJob.pageIds, []);
      assert.equal(calls, callsBeforeFailure + 1);
      await page.reload(); await dismiss(); await open();
      await wiki.getByText('模型输出达到长度上限，结果不完整。请减少所选资料或更换模型后重新生成。', { exact: true }).waitFor();
      assert.equal(calls, callsBeforeFailure + 1, 'reload must not retry failed models');
      truncate = false;
      await wiki.getByRole('button', { name: '生成 Wiki', exact: true }).click();
      await wiki.getByRole('checkbox', { name: '长文制度', exact: true }).check();
      const startedLong = page.waitForResponse((response) => response.url().endsWith('/wiki/generation-jobs') && response.request().method() === 'POST');
      await wiki.getByRole('button', { name: '开始生成（1 份）', exact: true }).click();
      await startedLong;
      await wiki.getByRole('button', { name: '开始生成（1 份）', exact: true }).waitFor({ state: 'hidden' });
      await wiki.getByText(/草稿已生成，请核对后发布/).waitFor({ timeout: 30000 });
      const longJob = (await api('/api/knowledge/wiki-e2e/wiki/generation-jobs', undefined, 'GET')).items[0];
      assert.equal(longJob.state, 'completed'); assert.equal(longJob.processedChunks, longJob.totalChunks);
      assert.ok(calls >= 3); assert.equal(longJob.pageIds.length, 2);
      await wiki.getByText(`已处理 ${longJob.totalChunks}/${longJob.totalChunks} 个文本块`, { exact: false }).waitFor();
      await wiki.getByRole('navigation', { name: 'Wiki 页面目录' }).getByRole('button', { name: /星桥报销/ }).click();
      const longPage = await api(`/api/knowledge/wiki-e2e/wiki/pages/${longJob.pageIds[0]}?view=drafts`, undefined, 'GET');
      assert.ok(longPage.revision.content.sections.length >= 2);
      assert.equal(new Set(longPage.revision.content.evidenceRefs.map((r) => r.evidence.chunkId)).size, longJob.totalChunks);
      await wiki.getByRole('checkbox', { name: /我已核对正文和来源/ }).check();
      await wiki.getByRole('button', { name: '发布此页', exact: true }).click();
      assert.equal((await api('/api/knowledge/wiki-e2e/wiki/search?query=差旅费用', undefined, 'GET')).items.length, 1);
      console.log('[wiki-ui] long document → sequential Pi calls → same-title sections/evidence → progress → publish/search: PASS');
      console.log('[wiki-ui] direct Wiki entry → page/section navigation → focus/collapse → real pagination preserves reading → narrow layout: PASS');
      console.log('[wiki-ui] real ingest → Pi generation → review/publish → alias/BM25 → links/source download → restart/delete: PASS');
    },
  };
}

import assert from 'node:assert/strict';

export async function runWikiEditingRegression(page, wiki, api, pageId) {
  const prefix = `/api/knowledge/wiki-e2e/wiki/pages/${pageId}`;
  const original = await api(prefix, undefined, 'GET');
  const originalRefs = original.revision.content.evidenceRefs;
  const editor = page.getByRole('dialog', { name: '编辑 Wiki 草稿', exact: true });
  await wiki.getByRole('button', { name: '编辑为新草稿', exact: true }).click();
  await editor.waitFor();
  const body = editor.getByRole('textbox', { name: '章节 1 正文', exact: true });
  const editedText = '发票必须真实有效。😀人工核对标记 EDIT731。';
  await editor.getByRole('textbox', { name: '页面标题', exact: true }).fill('发票规范（修订）');
  await editor.getByRole('textbox', { name: '别名（每行一个）', exact: true }).fill('票据核验\n票据核验');
  await editor.getByRole('textbox', { name: '页面摘要', exact: true }).fill('已核对原文的发票要求');
  await editor.getByRole('textbox', { name: '章节 1 标题', exact: true }).fill('核验要求');
  await body.fill(''); assert.equal(await editor.getByRole('button', { name: '保存草稿' }).isEnabled(), false);
  await body.fill(editedText);
  await editor.locator('summary').filter({ hasText: '版本对照' }).click();
  await editor.getByText('打开编辑时的已发布版本 → 本次编辑。', { exact: false }).waitFor();
  const [firstSection, retainedSection] = original.revision.content.sections;
  assert.ok((await editor.innerText()).includes(original.revision.content.bodyMarkdown.slice(firstSection.start, firstSection.end)));
  assert.equal(await editor.getByRole('textbox', { name: '章节 2 正文', exact: true }).inputValue(), original.revision.content.bodyMarkdown.slice(retainedSection.start, retainedSection.end));
  page.once('dialog', (dialog) => dialog.dismiss());
  await editor.getByRole('button', { name: '关闭编辑', exact: true }).click();
  assert.equal(await body.inputValue(), editedText);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (process.env.WORKEXPERT_WIKI_EDITOR_SCREENSHOT) {
    await editor.evaluate((el) => { el.scrollTop = 0; });
    await editor.screenshot({ path: process.env.WORKEXPERT_WIKI_EDITOR_SCREENSHOT });
  }
  // The server commits successfully, but the browser loses the response. Retrying must reuse the key.
  let lostKey;
  const draftUrl = '**' + prefix + '/draft';
  await page.route(draftUrl, async (route) => {
    lostKey = route.request().postDataJSON().idempotencyKey;
    const response = await route.fetch(); assert.equal(response.status(), 200);
    await route.abort('failed');
  });
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click();
  await editor.getByRole('alert').waitFor();
  assert.equal(await body.inputValue(), editedText);
  await page.unroute(draftUrl);
  const savedResponse = page.waitForResponse((r) => r.url().endsWith(`${prefix}/draft`) && r.request().method() === 'PUT');
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click();
  const retried = await savedResponse;
  assert.equal(retried.status(), 200); assert.equal(retried.request().postDataJSON().idempotencyKey, lostKey);
  await editor.waitFor({ state: 'hidden' });
  await wiki.getByRole('heading', { name: '发票规范（修订）', exact: true }).waitFor();
  const first = await api(prefix + '?view=drafts', undefined, 'GET');
  assert.equal(first.revision.authorType, 'human'); assert.equal(first.revision.content.sections[0].end, editedText.length);
  assert.equal(first.revision.content.sections[1].start, editedText.length + 2);
  assert.equal(first.revision.content.bodyMarkdown.slice(first.revision.content.sections[1].start, first.revision.content.sections[1].end), '发票应真实有效，报销前核对。');
  assert.deepEqual(first.revision.content.evidenceRefs, originalRefs);
  assert.deepEqual(first.revision.content.aliases, ['票据核验']);
  assert.equal((await api(prefix, undefined, 'GET')).revision.revisionId, original.revision.revisionId);
  assert.equal((await api('/api/knowledge/wiki-e2e/wiki/search?query=EDIT731', undefined, 'GET')).items.length, 0);
  assert.deepEqual((await api(prefix + '?revisionId=' + original.revision.revisionId, undefined, 'GET')).revision.content, original.revision.content);
  assert.equal(await wiki.getByRole('button', { name: '发布此页', exact: true }).isEnabled(), false);

  // Opening from the published view must select the already existing draft, not overwrite it.
  await wiki.getByRole('button', { name: '已发布', exact: true }).click();
  await wiki.getByRole('navigation', { name: 'Wiki 页面目录' }).getByRole('button', { name: /发票规范/ }).click();
  await wiki.getByRole('button', { name: '编辑草稿 / 对照版本', exact: true }).click(); await editor.waitFor();
  assert.equal(await editor.getByRole('textbox', { name: '页面标题', exact: true }).inputValue(), '发票规范（修订）');
  await editor.getByRole('textbox', { name: '页面标题', exact: true }).fill('我的未保存修改');
  const serverContent = { ...first.revision.content, title: '另一处编辑的版本' };
  await api(prefix + '/draft', { baseGeneration: first.page.generation, slug: first.page.slug, content: serverContent, idempotencyKey: 'concurrent-browser-edit' }, 'PUT');
  const conflicted = page.waitForResponse((r) => r.url().endsWith(`${prefix}/draft`) && r.request().method() === 'PUT');
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); assert.equal((await conflicted).status(), 409);
  await editor.getByText(/页面已被修改，本次输入已保留/).waitFor();
  assert.equal(await editor.getByRole('textbox', { name: '页面标题', exact: true }).inputValue(), '我的未保存修改');
  await editor.getByRole('button', { name: '对照最新版本', exact: true }).click();
  await editor.getByText('另一处编辑的版本', { exact: true }).waitFor();
  assert.equal(await editor.getByRole('button', { name: '保存草稿' }).isEnabled(), false);
  page.once('dialog', (dialog) => dialog.accept()); await editor.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  await wiki.getByRole('button', { name: '编辑草稿 / 对照版本', exact: true }).click(); await editor.waitFor();
  await editor.getByRole('textbox', { name: '页面标题', exact: true }).fill('发票规范（修订）');
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
  await wiki.getByRole('heading', { name: '发票规范（修订）', exact: true }).waitFor();
  assert.equal(await wiki.getByRole('checkbox', { name: /我已核对正文和来源/ }).isChecked(), false);
  await wiki.getByRole('checkbox', { name: /我已核对正文和来源/ }).check();
  const published = page.waitForResponse((r) => r.url().endsWith(`${prefix}/publish`));
  await wiki.getByRole('button', { name: '发布此页', exact: true }).click(); assert.equal((await published).status(), 200);
  await wiki.getByRole('button', { name: '编辑为新草稿', exact: true }).waitFor();
  assert.equal((await api('/api/knowledge/wiki-e2e/wiki/search?query=EDIT731', undefined, 'GET')).items[0].pageId, pageId);
  assert.equal((await api('/api/knowledge/wiki-e2e/wiki/search?query=票据核验', undefined, 'GET')).items[0].pageId, pageId);
  console.log('[wiki-editor] editable draft, UTF-16/source integrity, published isolation, immutable history, leave confirmation, CAS conflict preservation and republish: PASS');
}

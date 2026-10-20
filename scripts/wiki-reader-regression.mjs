import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWikiReader } from '../apps/renderer/src/features/knowledge/wiki-reader.ts';

const page = (id, title, target) => ({ page: { pageId: id }, revision: { content: { title, summary: '<img src=x>', bodyMarkdown: '<script>alert(1)</script>',
  sections: [{ sectionId: 's1', headingPath: ['<unsafe>'], start: 0, end: 25 }], links: [{ sourceSectionId: 's1', targetPageId: target, label: '<next>' }] } } });
test('WK-R15-T: passive HTML, escaped input, local links, unavailable targets and limits', () => {
  const html = buildWikiReader('<test>', [page('x', '<first>', 'y'), page('y', 'second', 'missing')]);
  assert.ok(html.includes('href="#page-1"'));
  assert.ok(html.includes('本快照不可用'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(buildWikiReader('empty', []).includes('暂无可阅读'));
  assert.throws(() => buildWikiReader('large', Array(201).fill(page('x', 'x', 'y'))), /200/);
  const large = page('x', 'x', 'y'); large.revision.content.bodyMarkdown = 'x'.repeat(4_000_001);
  assert.throws(() => buildWikiReader('large', [large]), /400/);
});

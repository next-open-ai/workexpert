import test from 'node:test';
import assert from 'node:assert/strict';
import type { WikiPageView } from '@workexpert/contracts';
import { expandWikiCandidates, recallWiki } from '../wiki-retrieval.js';

test('WK-X02: bounded one-hop, relevance, current publication, deduplication and provenance', () => {
  const direct = ['seed', 'second', 'third', 'fourth'].map((id, i) => ({ pageId: id, revisionId: 'r', title: id,
    snippet: '差旅流程', matchKinds: [] as [], rank: i + 1, freshness: 'current' as const, bm25: null,
    wiki: { pageId: id, revisionId: 'r', evidenceRefs: [], sourcesTruncated: false } }));
  const calls: string[] = [];
  const view = (id: string, body = '差旅流程审批', freshness = 'current', published = 'r') => ({
    page: { pageId: id, publishedRevisionId: published }, freshness,
    revision: { revisionId: 'r', content: { title: body, aliases: [], summary: body, bodyMarkdown: body, evidenceRefs: [] } },
  }) as unknown as WikiPageView;
  const views = new Map([['a', view('a')], ['b', view('b')], ['c', view('c')], ['d', view('d')],
    ['noise', view('noise', '天气预报')], ['stale', view('stale', '差旅', 'stale')], ['draft', view('draft', '差旅', 'current', '')]]);
  const store: Parameters<typeof expandWikiCandidates>[0] = {
    read: id => views.get(id),
    related: (id, direction, limit) => {
      calls.push(id); assert.equal(direction, 'out'); assert.equal(limit, 5);
      return (id === 'seed' ? ['a', 'noise', 'stale', 'draft', 'second'] : ['a', 'b', 'c', 'd']).map(pageId => ({
        pageId, revisionId: 'r', title: pageId, seedPageId: id, direction: 'out' as const,
      }));
    },
  };
  const result = expandWikiCandidates(store, direct, '差旅流程', 20);
  assert.deepEqual(calls, ['seed', 'second', 'third']);
  assert.deepEqual(result.map(hit => hit.pageId), ['seed', 'a', 'second', 'third', 'b', 'c', 'fourth']);
  assert.deepEqual(result[1].wiki.expansion, { seedPageId: 'seed', depth: 1 });
  assert.equal(expandWikiCandidates(store, direct, '差旅流程', 4).length, 4);
  assert.deepEqual(expandWikiCandidates(store, [], '差旅', 20), []);
  assert.deepEqual(recallWiki({ id: 'kb', name: 'kb', provider: 'lancedb', enabled: true, wikiRelatedExpansionEnabled: true }, '/never-open', '差旅', 20), []);
});

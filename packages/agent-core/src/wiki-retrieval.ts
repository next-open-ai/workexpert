import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { KnowledgeEvidenceStore, KnowledgeSourceStore, ImmutableFileStore } from '@workexpert/storage';
import type { KnowledgeWikiStore } from '@workexpert/storage';
import type { KnowledgeBaseRuntime, WikiRecall, WikiSearchHit } from '@workexpert/contracts';

/** The host supplies this runtime only after catalog authorization; never derive ownership from a page. */
function withWiki<T>(kb: KnowledgeBaseRuntime, directory: string, empty: T, read: (wiki: KnowledgeWikiStore) => T): T {
  if (kb.provider !== 'lancedb' || kb.wikiRetrievalEnabled !== true) return empty;
  if (!kb.wikiAccess) throw new Error('Wiki 检索缺少授权上下文，请重新打开知识库。');
  const { orgId, userId, sourceRoot } = kb.wikiAccess;
  const owner = { orgId, userId };
  const dbPath = path.join(directory, 'knowledge-evidence.sqlite');
  const sourcesPath = path.join(sourceRoot, 'sources.sqlite'), objects = path.join(sourceRoot, 'objects');
  if (!existsSync(dbPath)) return empty;
  if ([directory, dbPath, sourceRoot, sourcesPath, objects].some(p => existsSync(p) && lstatSync(p).isSymbolicLink())) {
    throw new Error('Wiki 检索存储路径不可用。');
  }
  let evidence: KnowledgeEvidenceStore | undefined, sources: KnowledgeSourceStore | undefined;
  try {
    evidence = new KnowledgeEvidenceStore(dbPath, { existingOnly: true, readOnly: true });
    // A missing archive must not let derived content bypass source validation.
    if (!existsSync(sourcesPath) || !existsSync(objects)) {
      if (!evidence.openExistingWiki({ ...owner, knowledgeBaseId: kb.id }, () => false)) return empty;
      throw new Error('Wiki 原文归档不可用。');
    }
    sources = new KnowledgeSourceStore(sourcesPath, new ImmutableFileStore(objects), { readOnly: true });
    const wiki = evidence.openExistingWiki({ ...owner, knowledgeBaseId: kb.id }, ref => {
      if (ref.evidence.verification !== 'versioned') return false;
      const snapshot = sources!.get(owner, ref.evidence.documentVersionId);
      return snapshot?.provider === 'lancedb' && snapshot.knowledgeBaseId === kb.id && snapshot.documentId === ref.evidence.documentId;
    });
    return wiki ? read(wiki) : empty;
  } finally { sources?.close(); evidence?.close(); }
}

type RecallHit = WikiSearchHit & { wiki: WikiRecall };
function relevanceTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const run of text.normalize('NFKC').toLowerCase().match(/\p{Script=Han}+|[\p{L}\p{N}]+/gu) ?? []) {
    if (/^\p{Script=Han}+$/u.test(run)) {
      const chars = [...run];
      if (chars.length === 1) tokens.add(run);
      for (let i = 0; i + 1 < chars.length; i++) tokens.add(chars[i] + chars[i + 1]);
    } else tokens.add(run);
  }
  return tokens;
}

/** Bounded one-hop candidates; never recursively traverse an expanded page. */
export function expandWikiCandidates(store: Pick<KnowledgeWikiStore, 'read' | 'related'>, direct: RecallHit[], query: string, limit: number): RecallHit[] {
  const tokens = [...relevanceTokens(query.slice(0, 256))];
  if (!tokens.length || !direct.length) return direct.slice(0, limit);
  const seen = new Set(direct.map(hit => hit.pageId));
  const extra: Array<{ score: number; hit: RecallHit }> = [];
  for (const seed of direct.slice(0, 3)) {
    for (const link of store.related(seed.pageId, 'out', 5)) {
      if (seen.has(link.pageId)) continue;
      seen.add(link.pageId);
      const view = store.read(link.pageId);
      if (!view || view.freshness !== 'current' || view.page.publishedRevisionId !== view.revision.revisionId) continue;
      const content = view.revision.content;
      const targetTokens = relevanceTokens([content.title, ...content.aliases, content.summary, content.bodyMarkdown].join(' '));
      const matched = tokens.filter(token => targetTokens.has(token));
      const score = matched.length / tokens.length;
      if (score < 0.25) continue;
      const position = content.bodyMarkdown.toLowerCase().indexOf(matched[0]);
      const start = Math.max(0, position - 60);
      extra.push({ score, hit: { pageId: link.pageId, revisionId: view.revision.revisionId, title: content.title,
        snippet: content.bodyMarkdown.slice(start, start + 240), matchKinds: [], rank: 1, freshness: 'current', bm25: null,
        wiki: { pageId: link.pageId, revisionId: view.revision.revisionId, evidenceRefs: content.evidenceRefs.slice(0, 8),
          sourcesTruncated: content.evidenceRefs.length > 8, expansion: { seedPageId: seed.pageId, depth: 1 } } } });
    }
  }
  extra.sort((a, b) => b.score - a.score || a.hit.pageId.localeCompare(b.hit.pageId));
  // Reserve one supplemental slot near the head so small final topK values can use it.
  return [...direct.slice(0, 1), ...extra.slice(0, 1).map(row => row.hit), ...direct.slice(1, 3),
    ...extra.slice(1, 3).map(row => row.hit), ...direct.slice(3)]
    .slice(0, limit).map((hit, index) => ({ ...hit, rank: index + 1 }));
}

export function recallWiki(kb: KnowledgeBaseRuntime, directory: string, query: string, limit: number): RecallHit[] {
  if (!query.trim()) return [];
  return withWiki(kb, directory, [], store => {
    const direct: RecallHit[] = store.search(query.slice(0, 256), Math.min(20, limit)).flatMap(hit => {
    const view = store.read(hit.pageId);
    if (!view || view.freshness !== 'current' || view.page.publishedRevisionId !== hit.revisionId) return [];
    return [{ ...hit, wiki: { pageId: hit.pageId, revisionId: hit.revisionId,
      evidenceRefs: view.revision.content.evidenceRefs.slice(0, 8), sourcesTruncated: view.revision.content.evidenceRefs.length > 8 } }];
    });
    return kb.wikiRelatedExpansionEnabled === true ? expandWikiCandidates(store, direct, query, Math.min(20, limit)) : direct;
  });
}

export function currentWikiRevisions(kb: KnowledgeBaseRuntime, directory: string, refs: WikiRecall[]): Set<string> {
  return withWiki(kb, directory, new Set<string>(), store => new Set(refs.filter(ref => {
    const view = store.read(ref.pageId);
    return view?.freshness === 'current' && view.page.publishedRevisionId === ref.revisionId;
  }).map(ref => `${ref.pageId}:${ref.revisionId}`)));
}

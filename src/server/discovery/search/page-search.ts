/**
 * M39 — `search_pages`, the replacement for grepping the specification.
 *
 * This is the one intention the entity graph CANNOT serve: by definition it
 * looks for what fell out of the graph — a bare HTTP path written in prose, a
 * DTO named in a sentence and never tagged. So `regex` is first-class, not a
 * bolt-on, and `mode: "pages" | "count"` answers "where does this appear at
 * all" without paying for every hit.
 *
 * There is no full-text index in this project (no FTS table exists in any
 * migration), so this is an honest disk scan across the roots. That cost is the
 * reason `mode: "count"` exists and the reason the default limit is not ∞.
 *
 * Hit IDENTITY degrades with the root, it is not gated by it: a section-indexed
 * root answers with an `anchor`, a root without an index answers with
 * `(rootId, path, line)`. Both are addressable; one is just coarser.
 */

import type { Database } from 'better-sqlite3';
import { invalidArgument } from '../errors.js';
import type { PageSource } from '../page-source.js';
import { DEFAULT_LIMITS, paginate } from '../pagination.js';
import { compareRanked } from '../ranking.js';
import type { RootSet } from '../roots.js';
import type { SearchPageHit, SearchPagesInput, SearchPagesResult } from '../types.js';

const MAX_FRAGMENT = 200;

export async function searchPages(
  db: Database,
  pages: PageSource,
  roots: RootSet,
  input: SearchPagesInput,
): Promise<SearchPagesResult> {
  const matcher = buildMatcher(input);
  const targets = input.rootId ? [roots.require(input.rootId, 'search_pages')] : [...roots.all];

  const hits: Array<SearchPageHit & { key: string }> = [];
  const perPage = new Map<string, { rootId: string; path: string; matchCount: number }>();

  for (const root of targets) {
    const anchors = root.sectionIndexed ? anchorIndex(db, root.id) : null;
    for (const rel of await safeList(pages, root.id)) {
      let content: string;
      try {
        // Frontmatter-stripped: a hit's `line` has to be comparable with the
        // section index's line ranges, or the anchor attached to it is wrong.
        content = await pages.readBody(root.id, rel);
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i] ?? '';
        if (!matcher(text)) continue;
        const line = i + 1;
        const key = `${root.id}:${rel}:${line}`;
        const fragment = text.trim().slice(0, MAX_FRAGMENT);
        // Earlier lines score marginally higher so ordering is stable and
        // roughly document-ordered within a page; `key` breaks every remaining
        // tie, which is what keeps `offset` honest.
        const score = 1000 - Math.min(line, 900);
        const anchor = anchors ? anchorFor(anchors, rel, line) : undefined;
        hits.push(
          anchor
            ? { kind: 'section', rootId: root.id, anchor, path: rel, line, fragment, score, key }
            : { kind: 'line', rootId: root.id, path: rel, line, fragment, score, key },
        );
        const pageKey = `${root.id}:${rel}`;
        const entry = perPage.get(pageKey);
        if (entry) entry.matchCount++;
        else perPage.set(pageKey, { rootId: root.id, path: rel, matchCount: 1 });
      }
    }
  }

  const mode = input.mode ?? 'hits';
  if (mode === 'count') return { mode: 'count', total: hits.length };
  if (mode === 'pages') {
    const items = [...perPage.values()].sort(
      (a, b) => b.matchCount - a.matchCount || a.rootId.localeCompare(b.rootId) || a.path.localeCompare(b.path),
    );
    return { ...paginate(items, input, DEFAULT_LIMITS.searchPages), mode: 'pages' };
  }

  hits.sort(compareRanked);
  const page = paginate(hits, input, DEFAULT_LIMITS.searchPages);
  return {
    ...page,
    items: page.items.map(({ key: _key, ...hit }) => hit),
    mode: 'hits',
  };
}

function buildMatcher(input: SearchPagesInput): (line: string) => boolean {
  if (input.regex && input.query) {
    throw invalidArgument(
      'search_pages takes either query or regex, not both',
      'search_pages({ query: "text" }) for a phrase, search_pages({ regex: "^GET /v1/" }) for a pattern',
    );
  }
  if (input.regex) {
    let re: RegExp;
    try {
      re = new RegExp(input.regex, 'i');
    } catch (err) {
      throw invalidArgument(
        `invalid regex: ${(err as Error).message}`,
        'pass a JavaScript regular expression body without delimiters, e.g. "^## M\\\\d+"',
      );
    }
    return (line) => re.test(line);
  }
  const query = input.query?.trim();
  if (!query) {
    throw invalidArgument(
      'search_pages requires query or regex',
      'search_pages({ query: "checkout" }) or search_pages({ regex: "POST /orders" })',
    );
  }
  const lower = query.toLowerCase();
  return (line) => line.toLowerCase().includes(lower);
}

async function safeList(pages: PageSource, rootId: string): Promise<string[]> {
  try {
    return await pages.list(rootId);
  } catch {
    return [];
  }
}

interface AnchorRow {
  path: string;
  anchor: string;
  start: number;
  end: number;
}

function anchorIndex(db: Database, rootId: string): AnchorRow[] {
  return db
    .prepare(
      `SELECT page_path AS path, anchor, line_start AS start, line_end AS end
         FROM section_index WHERE rootId = ? ORDER BY page_path, line_start`,
    )
    .all(rootId) as AnchorRow[];
}

/** The innermost section containing `line` — the deepest range wins, so a hit
 *  inside a sub-section reports the sub-section rather than its parent. */
function anchorFor(rows: readonly AnchorRow[], path: string, line: number): string | undefined {
  let best: AnchorRow | undefined;
  for (const row of rows) {
    if (row.path !== path || line < row.start || line > row.end) continue;
    if (!best || row.end - row.start < best.end - best.start) best = row;
  }
  return best?.anchor;
}

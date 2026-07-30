/**
 * M39 — `list_pages` and `get_page`.
 *
 * Together with `list_sections` + `get_section` these are the full replacement
 * for reading the specification with `Glob` and `Read`. The difference that
 * matters is not the name: a glob has no pagination, no measurement and no
 * notion of a root, so it can address a brief, a patch or the entity catalogue.
 * These cannot — they take `(rootId, relPath)` and the root list contains only
 * page roots.
 */

import type { Database } from 'better-sqlite3';
import { truncateText } from '../budget.js';
import { invalidArgument } from '../errors.js';
import type { PageSource } from '../page-source.js';
import { DEFAULT_LIMITS, paginate } from '../pagination.js';
import type { RootSet } from '../roots.js';
import type { GetPageInput, GetPageResult, ListPagesInput, ListPagesResult, PageListItem } from '../types.js';

export async function listPages(
  db: Database,
  pages: PageSource,
  roots: RootSet,
  input: ListPagesInput,
): Promise<ListPagesResult> {
  const root = roots.require(input.rootId, 'list_pages');
  const files = await pages.listWithStats(root.id);

  const counts = sectionCounts(db, root.id);
  const prefix = input.prefix?.replace(/^\/+/, '');
  const items: PageListItem[] = files
    .filter((f) => !prefix || f.path.startsWith(prefix))
    .map((f) => ({
      rootId: f.rootId,
      path: f.path,
      title: f.title,
      sectionCount: counts.get(f.path) ?? 0,
      size: f.size,
      mtime: new Date(f.mtimeMs).toISOString(),
    }));

  // Sort is an EXPLICIT parameter, never a side effect of how the filesystem
  // handed the entries back. `path` is the default because it is the only order
  // that stays put between two calls, which is what `offset` depends on.
  const sort = input.sort ?? 'path';
  items.sort(
    sort === 'modified'
      ? (a, b) => b.mtime.localeCompare(a.mtime) || a.path.localeCompare(b.path)
      : (a, b) => a.path.localeCompare(b.path),
  );

  return paginate(items, input, DEFAULT_LIMITS.listPages);
}

function sectionCounts(db: Database, rootId: string): Map<string, number> {
  const rows = db
    .prepare('SELECT page_path AS path, COUNT(*) AS c FROM section_index WHERE rootId = ? GROUP BY page_path')
    .all(rootId) as Array<{ path: string; c: number }>;
  return new Map(rows.map((r) => [r.path, r.c]));
}

export async function getPage(
  pages: PageSource,
  roots: RootSet,
  input: GetPageInput,
): Promise<GetPageResult> {
  const root = roots.require(input.rootId, 'get_page');
  if (!input.path) {
    throw invalidArgument(
      'get_page requires path',
      `get_page({ rootId: "${root.id}", path: "<relative path>" }) — use list_pages({ rootId: "${root.id}" }) to see them`,
    );
  }

  /**
   * `range` on a section-indexed root is refused rather than served. Line
   * windows are the tool of last resort — on a root that HAS anchors, a section
   * is a better window in every way (it is semantic, it is measurable up front,
   * and it carries its own edges), and quietly serving lines would teach an
   * agent to keep asking for the worse thing.
   */
  if (input.range && root.sectionIndexed) {
    throw invalidArgument(
      `root '${root.id}' is section-indexed, so a line range is the wrong window onto it`,
      `use list_sections({ by: "page", rootId: "${root.id}", path: "${input.path}" }) then get_section({ anchor })`,
    );
  }

  let content = await pages.read(root.id, input.path);
  const lines = content.split('\n');
  const total = lines.length;
  let hasMore = false;

  if (input.range) {
    const { start, end } = input.range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw invalidArgument(
        `invalid range { start: ${String(start)}, end: ${String(end)} }`,
        'range is 1-based and inclusive: { start: 1, end: 200 }',
      );
    }
    content = lines.slice(start - 1, end).join('\n');
    hasMore = end < total;
  }

  const budgeted = truncateText(
    content,
    `page truncated by response budget — re-read a window with get_page({ rootId: "${root.id}", path: "${input.path}", range: { start, end } })`,
  );

  return {
    rootId: root.id,
    path: input.path,
    content: budgeted.text,
    ...(budgeted.truncated ? { truncated: true, truncationHint: budgeted.truncationHint } : {}),
    total,
    hasMore: hasMore || budgeted.truncated,
  };
}

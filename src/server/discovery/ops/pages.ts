/**
 * M39 — `list_pages` and `get_page`.
 *
 * Together with `list_sections` + `get_sections` these are the full replacement
 * for reading the specification with `Glob` and `Read`. The difference that
 * matters is not the name: a glob has no pagination, no measurement and no
 * notion of a root, so it can address a brief, a patch or the entity catalogue.
 * These cannot — they take `(rootId, relPath)` and the root list contains only
 * page roots.
 */

import crypto from 'node:crypto';
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

/** The same digest `services/page-write.ts` compares `expectedHash` against. */
function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
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
   * ONE predicate, two consumers: the refusal below and the truncation hint
   * further down. They used to be independent `if`s, which is how a page on an
   * indexed root came back cut with an instruction to re-read it via `range` —
   * the very argument the refusal rejects. An agent following that hint looped:
   * get_page → hint → range → INVALID_ARGUMENT → get_page.
   *
   * The rule this encodes: a hint never proposes a call the same operation
   * would refuse. Keep the two gated by this single value, not by two
   * conditions that happen to agree today.
   */
  const lineWindowsRefused = root.sectionIndexed;

  /**
   * `range` on a section-indexed root is refused rather than served. Line
   * windows are the tool of last resort — on a root that HAS anchors, a section
   * is a better window in every way (it is semantic, it is measurable up front,
   * and it carries its own edges), and quietly serving lines would teach an
   * agent to keep asking for the worse thing.
   */
  if (input.range && lineWindowsRefused) {
    throw invalidArgument(
      `root '${root.id}' is section-indexed, so a line range is the wrong window onto it`,
      `use list_sections({ by: "page", rootId: "${root.id}", path: "${input.path}" }) then get_sections({ anchors })`,
    );
  }

  let content = await pages.read(root.id, input.path);
  /**
   * Hashed HERE — before `range` narrows it and before the budget truncates it.
   * `expectedHash` is compared against the whole file on disk, so a hash of a
   * window would fail every write that used it, and a caller cannot tell from
   * the value which of the two it holds.
   */
  const hash = sha256(content);

  if (input.range) {
    const { start, end } = input.range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw invalidArgument(
        `invalid range { start: ${String(start)}, end: ${String(end)} }`,
        'range is 1-based and inclusive: { start: 1, end: 200 }',
      );
    }
    content = content.split('\n').slice(start - 1, end).join('\n');
  }

  const budgeted = truncateText(
    content,
    lineWindowsRefused
      ? `page truncated by response budget — list this page's sections with list_sections({ by: "page", rootId: "${root.id}", path: "${input.path}" }), then read them with get_sections({ anchors })`
      : `page truncated by response budget — re-read a window with get_page({ rootId: "${root.id}", path: "${input.path}", range: { start, end } })`,
  );

  return {
    rootId: root.id,
    path: input.path,
    content: budgeted.text,
    hash,
    ...(budgeted.truncated ? { truncated: true, truncationHint: budgeted.truncationHint } : {}),
  };
}

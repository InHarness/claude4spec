/**
 * M39 — `list_pages` and `get_page`.
 *
 * Together with `get_page_outline` + `get_sections` these are the full replacement
 * for reading the specification with `Glob` and `Read`. The difference that
 * matters is not the name: a glob has no pagination, no measurement and no
 * notion of a root, so it can address a brief, a patch or the entity catalogue.
 * These cannot — they take `(rootId, relPath)` and the root list contains only
 * page roots.
 */

import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { applyItemBudget, DEFAULT_BUDGET_CHARS, MAX_ANCHORS_PER_CALL } from '../budget.js';
import { invalidArgument } from '../errors.js';
import type { PageSource } from '../page-source.js';
import { DEFAULT_LIMITS, paginate } from '../pagination.js';
import type { RootSet } from '../roots.js';
import type {
  GetPageInput,
  GetPageResult,
  ListPagesInput,
  ListPagesResult,
  PageListItem,
  PageSectionItem,
} from '../types.js';
import { pageStructure } from '../../../shared/section-parser.js';
import { parseFrontmatterFields } from '../../services/pages.js';

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
  budgetChars = DEFAULT_BUDGET_CHARS,
): Promise<GetPageResult> {
  const root = roots.require(input.rootId, 'get_page');
  if (!input.path) {
    throw invalidArgument(
      'get_page requires path',
      `get_page({ rootId: "${root.id}", path: "<relative path>" }) — use list_pages({ rootId: "${root.id}" }) to see them`,
    );
  }

  /**
   * ONE predicate, two consumers: the refusal below and the cut message
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
      `use get_page_outline({ rootId: "${root.id}", path: "${input.path}" }) then get_sections({ anchors })`,
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

  let fromTop = true;
  if (input.range) {
    const { start, end } = input.range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw invalidArgument(
        `invalid range { start: ${String(start)}, end: ${String(end)} }`,
        'range is 1-based and inclusive: { start: 1, end: 200 }',
      );
    }
    content = content.split('\n').slice(start - 1, end).join('\n');
    // A window that does not open on line 1 has no frontmatter: its leading
    // `---` is a thematic break.
    fromTop = start === 1;
  }

  /**
   * 2.1.6 — the page as STRUCTURE, parsed from the text just read (never from
   * `section_index`, so no freshness gate). On a root without a section index
   * there are no anchors to hand out, so no item carries one — an anchor-shaped
   * comment there is just text.
   */
  const page = pageStructure(content, { frontmatter: fromTop });
  const items: PageSectionItem[] = page.sections.map((s) => ({
    ...(s.anchor !== null && root.sectionIndexed ? { anchor: s.anchor } : {}),
    heading_text: s.heading,
    heading_level: s.level,
    body: s.body,
  }));
  const frontmatter =
    page.frontmatter === null
      ? undefined
      : (() => {
          const fields = parseFrontmatterFields(page.frontmatter);
          return { raw: page.frontmatter, ...(fields ? { fields } : {}) };
        })();

  /**
   * The budget. Nothing is DROPPED: an item past the line keeps its anchor and
   * heading and loses its body (`applyItemBudget`'s degrade), so the caller
   * still sees the whole shape of the page and knows exactly what to fetch.
   * The preamble and the FIRST item are cut as text instead — a page whose one
   * heading carries an over-budget body would otherwise answer with nothing to
   * read and no smaller request to make.
   */
  let remaining = budgetChars - JSON.stringify({ rootId: root.id, path: input.path, hash, frontmatter }).length;
  let preamble = page.preamble ?? undefined;
  let preambleCut: { kept: number; total: number } | null = null;
  if (preamble !== undefined) {
    if (preamble.length > remaining) {
      preambleCut = { kept: Math.max(0, remaining), total: preamble.length };
      preamble = preamble.slice(0, Math.max(0, remaining));
    }
    remaining -= JSON.stringify(preamble).length;
  }
  if (items.length) {
    const first = items[0]!;
    const cost = JSON.stringify(first).length;
    if (cost > remaining) {
      const keep = Math.max(0, first.body!.length - (cost - Math.max(0, remaining)));
      items[0] = { ...first, body: first.body!.slice(0, keep), truncated: true };
    }
  }
  const budgeted = applyItemBudget(
    items,
    ({ body: _body, ...meta }) => ({ ...meta, truncated: true as const }),
    '',
    Math.max(0, remaining),
  );
  const results = budgeted.items;
  const cut = results.filter((i) => i.truncated);

  const messages: string[] = [];
  if (preambleCut) {
    messages.push(
      `The preamble was cut by the response budget: ${preambleCut.kept} of its ${preambleCut.total} characters came back.`,
    );
  }
  if (cut.length) {
    messages.push(
      lineWindowsRefused ? indexedCutMessage(cut) : `${plural(cut.length)} cut by the response budget.`,
    );
  }
  if ((preambleCut || cut.length) && !lineWindowsRefused) {
    messages.push(
      `Re-read a window with get_page({ rootId: "${root.id}", path: "${input.path}", range: { start, end } }).`,
    );
  }

  return {
    rootId: root.id,
    path: input.path,
    hash,
    ...(frontmatter ? { frontmatter } : {}),
    ...(preamble !== undefined ? { preamble } : {}),
    results,
    ...(messages.length ? { truncated: true as const, message: messages.join(' ') } : {}),
  };
}

function plural(n: number): string {
  return `${n} section${n === 1 ? '' : 's'}`;
}

/**
 * On a section-indexed root the way on is ALWAYS `get_sections` — never `range`,
 * which this operation refuses there. The message names every cut anchor; the
 * call it proposes carries at most one batch of them, the most `get_sections`
 * accepts. The write it names closes the loop: `hash` arms `expectedHash`.
 */
function indexedCutMessage(cut: readonly PageSectionItem[]): string {
  const anchors = cut.flatMap((i) => (i.anchor ? [i.anchor] : []));
  const untagged = cut.length - anchors.length;
  const parts: string[] = [];
  if (anchors.length) {
    const batch = anchors.slice(0, MAX_ANCHORS_PER_CALL).map((a) => `"${a}"`).join(', ');
    parts.push(
      `${plural(anchors.length)} cut by the response budget: ${anchors.join(', ')}. ` +
        `Fetch ${anchors.length === 1 ? 'it' : 'them'} with get_sections({ anchors: [${batch}] })` +
        (anchors.length > MAX_ANCHORS_PER_CALL ? ` (at most ${MAX_ANCHORS_PER_CALL} per call)` : '') +
        '; write with update_sections using this hash as expectedHash.',
    );
  }
  if (untagged) {
    parts.push(
      `${plural(untagged)} without an anchor yet cut as well — readable once the indexer has tagged ${untagged === 1 ? 'its heading' : 'their headings'}.`,
    );
  }
  return parts.join(' ');
}

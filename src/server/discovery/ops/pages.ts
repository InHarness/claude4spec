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
import { DEFAULT_BUDGET_CHARS, MAX_ANCHORS_PER_CALL } from '../budget.js';
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
   * heading and loses its body (`applyItemBudget`'s rule), so the caller
   * still sees the whole shape of the page and knows exactly what to fetch.
   * The preamble and the FIRST item are cut as text instead — a page whose one
   * heading carries an over-budget body would otherwise answer with nothing to
   * read and no smaller request to make.
   *
   * Because every item ships, a degraded one as its skeleton, the skeletons
   * behind an item — and the message's mention of each cut anchor — are priced
   * BEFORE that item's body is admitted. Pricing them only after the cut is how
   * a page of many sections answered far past the budget, and past the
   * transport ceiling a result vanishes whole. Costs are JSON lengths, never
   * raw string lengths: escaping (`\n`, `"`) makes the two differ.
   */
  const degrade = ({ body: _body, ...meta }: PageSectionItem): PageSectionItem => ({ ...meta, truncated: true });
  const skeletonCost = items.map(
    (i) => JSON.stringify(degrade(i)).length + 1 + (i.anchor ? 2 * i.anchor.length + MESSAGE_CHARS_PER_ANCHOR : 0),
  );
  /** `tail[k]` — what items k.. cost as skeletons. */
  const tail = new Array<number>(items.length + 1).fill(0);
  for (let k = items.length - 1; k >= 0; k--) tail[k] = tail[k + 1]! + skeletonCost[k]!;

  let remaining =
    budgetChars -
    JSON.stringify({ rootId: root.id, path: input.path, hash, frontmatter, results: [], truncated: true, message: '' })
      .length -
    MESSAGE_RESERVE_CHARS;
  let preamble = page.preamble ?? undefined;
  let preambleCut: { kept: number; total: number } | null = null;
  if (preamble !== undefined) {
    const total = preamble.length;
    const cost = (s: string) => JSON.stringify({ preamble: s }).length;
    preamble = fitPrefix(preamble, cost, remaining - tail[0]!);
    if (preamble.length < total) preambleCut = { kept: preamble.length, total };
    remaining -= cost(preamble);
  }
  const results: PageSectionItem[] = [];
  let spent = 0;
  let cutFrom: number | null = null;
  items.forEach((item, k) => {
    if (cutFrom !== null) {
      results.push(degrade(item));
      return;
    }
    const avail = remaining - spent - tail[k + 1]!;
    const cost = JSON.stringify(item).length + 1;
    if (cost <= avail) {
      results.push(item);
      spent += cost;
    } else if (k === 0) {
      const cutItem = { ...item, truncated: true as const };
      const body = fitPrefix(item.body!, (s) => JSON.stringify({ ...cutItem, body: s }).length + 1, avail);
      results.push({ ...cutItem, body });
      spent += JSON.stringify({ ...cutItem, body }).length + 1;
    } else {
      cutFrom = k;
      results.push(degrade(item));
    }
  });
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

/**
 * What the cut message costs beyond the anchors it names: its fixed prose (the
 * preamble notice, the `get_sections` / `range` instruction, the untagged note)
 * plus the envelope keys around it. Reserved whether or not a cut happens.
 */
const MESSAGE_RESERVE_CHARS = 600;

/**
 * Per cut anchor, beyond twice its length: the message lists it once and the
 * proposed `get_sections` batch quotes it again (JSON-escaped quotes, comma).
 */
const MESSAGE_CHARS_PER_ANCHOR = 10;

/** The longest prefix of `text` whose `cost` stays within `avail` (empty when nothing fits). */
function fitPrefix(text: string, cost: (s: string) => number, avail: number): string {
  if (cost(text) <= avail) return text;
  // Binary search: a JSON cost is monotonic in the prefix length but not linear in it.
  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cost(text.slice(0, mid)) <= avail) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo);
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

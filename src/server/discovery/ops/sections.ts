/**
 * M39 — `get_page_outline` and `get_sections`.
 *
 * 0.2.59 — `list_sections` is gone and `get_page_outline` stands in its place. It
 * looks like a rename and is not: the discriminated union, the pagination, the
 * `is_known` probe and the flat row shape all went with the name.
 *
 * What is left is a FETCH BY ONE PAGE KEY that answers with a TREE of headings in
 * document order — a table of contents. No `by`, no anchor variant, no fuzzy
 * `query`, no `limit`/`offset`, no depth cap. The valve is the response budget
 * alone, which is a third category of pagination exemption beside "bounded by
 * construction" (`overview`, `describe_types`) and "fetch by key"
 * (`get_entities`, `get_sections`): a response keyed by ONE resource has no
 * narrowing parameter to offer, because a window into a tree is not a tree.
 *
 * The anchor variant left without a replacement, deliberately: a `search_pages`
 * hit already carries an anchor, so there was nothing left to look up in between.
 * That shortens the read path from three calls to two and makes this operation an
 * optional table of contents rather than a mandatory hop — "the cheap step between
 * locating a page and paying for any of its text".
 *
 * Anchor validation lost its probe with `is_known`. It is now `check_consistency`
 * in bulk, or a per-item `SECTION_NOT_FOUND` from `get_sections` as an existence
 * test — which narrows `SECTION_NOT_FOUND` to a single emitter.
 *
 * Sections exist only on roots with `sectionIndexed`, so both operations iterate
 * that subset. There is no `rootId === 'pages'` branch anywhere here.
 */

import type { Database } from 'better-sqlite3';
import type { DiscoveryError, DiscoveryErrorCode } from '../errors.js';
import { invalidArgument, sectionNotFound } from '../errors.js';
import type { PageSource } from '../page-source.js';
import type { RawEntityReader, RawSection } from '../raw-entity-reader.js';
import type { RootSet } from '../roots.js';
import { serializeSection } from '../../serialization/serializers/section.js';
import { bodySize, hydrateSectionFrom, ownBodyEnd } from '../section-hydrator.js';
import {
  applyItemBudget,
  DEFAULT_BUDGET_CHARS,
  MAX_ANCHORS_PER_CALL,
  MAX_SECTION_ITEMS_PER_RESPONSE,
  truncateText,
} from '../budget.js';
import type {
  GetSectionsInput,
  GetSectionsItem,
  GetPageOutlineInput,
  GetPageOutlineResult,
  GetSectionsResult,
  OutlineNode,
  SectionEdges,
  SectionResultItem,
} from '../types.js';

export async function getPageOutline(
  db: Database,
  pages: PageSource,
  roots: RootSet,
  input: GetPageOutlineInput,
): Promise<GetPageOutlineResult> {
  const root = roots.requireSectionIndexed(input.rootId, 'get_page_outline');
  /**
   * A missing `path` is refused rather than answered. `page_path = NULL` matches no
   * row, so without this the call would come back "that page has no sections" for a
   * call that never named a page — and every sibling operation (`get_page`,
   * `search_pages`, `find_references({ target: "page" })`) refuses the same shape.
   */
  if (!input.path) {
    throw invalidArgument(
      'get_page_outline requires path',
      `get_page_outline({ rootId: "${root.id}", path: "<relative path>" }) — use list_pages({ rootId: "${root.id}" }) to see them`,
    );
  }

  /**
   * The page is read FIRST, and a failure to read it is the operation's refusal.
   *
   * This is where the contract diverges from `list_sections({ by: "page" })`, which
   * answered an empty list for a path that did not exist. `get_page_outline` is
   * single-target — one page key, no union and no batch — so it refuses by ENVELOPE,
   * the way `get_page` does, rather than per-item the way `get_sections` does. And it
   * cannot do otherwise and still keep its promise: the envelope's `hash` is the
   * value a sectional edit closes on, so an operation that "succeeded" with no page
   * behind it would hand back an envelope with nothing to write against.
   *
   * The refusal is `PageSource`'s, not a `catch` here: it already turns ENOENT into
   * `PAGE_NOT_FOUND` and a path escaping the root into its own code. Wrapping it
   * would flatten everything else — a permission error, a directory where a file is
   * expected — into "no such page", sending the caller to `list_pages` to look for
   * something `list_pages` will happily show them.
   */
  const read = await pages.readWithHash(root.id, input.path);

  const rows = selectSections(db, 'WHERE rootId = ? AND page_path = ?', [root.id, input.path]);

  return {
    rootId: root.id,
    path: input.path,
    hash: read.hash,
    ...buildOutline(rows, read.body),
  };
}

/**
 * The tree, and the budget that may cut it short.
 *
 * `rows` arrive in document order (`selectSections` orders by `line_start`), which
 * is the order the tree is emitted in and the order the budget consumes them in.
 * Nothing re-sorts: the tree "goes the way the page is written" is the contract.
 */
function buildOutline(
  rows: readonly RawSection[],
  pageBody: string,
): { sections: OutlineNode[]; truncated?: true; message?: string } {
  const nodes = new Map<string, OutlineNode>();
  for (const row of rows) {
    nodes.set(row.anchor, {
      anchor: row.anchor,
      heading: row.headingText,
      level: row.headingLevel,
      // The page is read ONCE for the whole outline, not once per section:
      // measurement before fetching is the point of the operation, and paying a
      // read per heading to deliver it would defeat it.
      size: bodySize(pageBody, row),
    });
  }

  /**
   * Emission is a PRE-ORDER walk, and the budget stops it at the first node that
   * would not fit. That is what makes truncation a PREFIX rather than a sample: a
   * prefix of a pre-order sequence is closed under parents by construction, so no
   * returned node can name a parent the envelope does not contain. It is also why
   * there is no `offset` — a window into a tree returns nodes whose parents are
   * missing, which is not a tree.
   */
  const roots: OutlineNode[] = [];
  let spent = 0;
  let truncated = false;
  for (const row of rows) {
    const node = nodes.get(row.anchor)!;
    /**
     * A parent that is not on THIS page is no parent here. It happens: an anchor
     * blocked by a collision with another page keeps its row over there, so a child
     * on this page can point off-page. Such a node is emitted as a root of this
     * page's tree rather than dropped — a shallower tree is truthful, a missing
     * section is not.
     */
    const parent = row.parentAnchor ? nodes.get(row.parentAnchor) : undefined;
    // Priced as it ships. `children` is not counted here because the child pays for
    // itself when its own turn comes.
    const cost = JSON.stringify(node).length;
    if (spent + cost > DEFAULT_BUDGET_CHARS && (roots.length > 0 || parent)) {
      truncated = true;
      break;
    }
    spent += cost;
    if (parent) (parent.children ??= []).push(node);
    else roots.push(node);
  }

  return {
    sections: roots,
    ...(truncated ? { truncated: true as const, message: OUTLINE_TRUNCATION_MESSAGE } : {}),
  };
}

/**
 * What a caller does with a cut outline — and what they must NOT be told to do.
 *
 * The prefix that came back is complete in itself: every node in it has its parent
 * in it, so it can be read and acted on exactly as an untruncated outline can. The
 * way on is `get_sections` over the anchors already in hand.
 *
 * There is deliberately NO "retry smaller" here, unlike `get_sections`, whose hint
 * ends in exactly that. The rule that governs both is the same — a hint never
 * proposes a call this operation would refuse — and this operation has no narrowing
 * parameter at all: no `limit`, no `offset`, no depth cap. Offering a smaller retry
 * would name a call that cannot be written.
 */
const OUTLINE_TRUNCATION_MESSAGE =
  'outline truncated by response budget — what came back is a PREFIX of the tree and is complete in itself: ' +
  'every node present has its parent present. There is no smaller retry to make (this operation takes no ' +
  'limit, offset or depth), so go on from here: read the sections you need with get_sections({ anchors }) ' +
  'using the anchors already returned.';

/**
 * 0.2.46 — every column a `RawSection` is built from, and not one more.
 *
 * Was `SELECT *`, which was harmless until the index started materializing
 * `body`: a section's body runs to the next heading of its own level, so an H1
 * row carries a whole page. `toRawSection` never reads it — `get_sections`
 * slices the file — so a star here would load the corpus to throw it away.
 */
export const RAW_SECTION_COLUMNS =
  'rootId, anchor, page_path, parent_anchor, heading_slug, heading_text, heading_level, content_hash, line_start, line_end';

export function selectSections(db: Database, where: string, params: unknown[]): RawSection[] {
  const rows = db
    .prepare(`SELECT ${RAW_SECTION_COLUMNS} FROM section_index ${where} ORDER BY page_path, line_start`)
    .all(...(params as never[])) as Array<Record<string, unknown>>;
  return rows.map(toRawSection);
}

export function toRawSection(row: Record<string, unknown>): RawSection {
  return {
    rootId: row.rootId as string,
    anchor: row.anchor as string,
    pagePath: row.page_path as string,
    parentAnchor: (row.parent_anchor as string | null) ?? null,
    headingSlug: row.heading_slug as string,
    headingText: row.heading_text as string,
    headingLevel: row.heading_level as number,
    contentHash: row.content_hash as string,
    lineStart: row.line_start as number,
    lineEnd: row.line_end as number,
  };
}

/**
 * 0.2.5 — `get_sections`, the batched successor to `get_section`.
 *
 * The batching lives HERE and nowhere below: the section serializer (M06) still
 * serializes exactly one section, and this loop calls it once per section. A
 * serializer that knew about lists would be a second definition of what a
 * section is.
 *
 * 0.2.84 — ONE ITEM PER SECTION, not one per requested anchor. `includeSubtree`
 * used to widen a single record (the children rode inside the parent's `body`,
 * and a requested anchor swallowed that way came back as `{ anchor, coveredBy }`).
 * It now widens the SET of records: every section of the subtree is its own
 * full item, the parent carries only its own body, and the covered variant is
 * gone. A child's anchor is then a key of the response rather than an HTML
 * comment buried in someone else's body, and when the budget cuts, the caller
 * learns exactly which anchors lost their text.
 *
 * Three valves, in the order they bite:
 *
 * 1. `anchors[]` length — a REFUSAL at the input (`MAX_ANCHORS_PER_CALL`).
 * 2. Item ceiling after expansion — a CUT to a prefix of the output order
 *    (`MAX_SECTION_ITEMS_PER_RESPONSE`), decided structurally from the index
 *    before a single body is read. Error items count.
 * 3. Response budget — the existing degradation, over what survived 2.
 *
 * The two cuts have DISJOINT remedies and the envelope's `message` says which
 * one applies: the budget regime can be retried with a smaller subset, the
 * ceiling regime cannot (the caller does not know what it is missing), so it is
 * sent to `get_page_outline` for the anchors instead.
 */
export async function getSections(
  db: Database,
  pages: PageSource,
  roots: RootSet,
  reader: RawEntityReader,
  input: GetSectionsInput,
): Promise<GetSectionsResult> {
  const requested = Array.isArray(input.anchors) ? input.anchors : [];
  if (requested.length === 0 || requested.length > MAX_ANCHORS_PER_CALL) {
    throw invalidArgument(
      `anchors[] must contain 1..${MAX_ANCHORS_PER_CALL} entries, got ${requested.length}`,
      `get_sections({ anchors: ["<anchor>", …] }) — split a longer list across calls; this operation does not paginate`,
    );
  }

  // Silent de-duplication, first occurrence wins its position. Repeating an
  // anchor is a caller mistake with an obvious intent, not something to refuse.
  const anchors = [...new Set(requested)];
  const includeSubtree = input.includeSubtree ?? false;

  const rows = new Map<string, RawSection | null>();
  for (const anchor of anchors) rows.set(anchor, reader.getSection(anchor) ?? null);

  /**
   * Which anchors can actually produce a body. A section on a root that has
   * LOST its section index is not addressable, and a de-indexed root takes its
   * whole page down together — so nothing on it has a subtree to expand either.
   */
  const indexed = new Set(roots.sectionIndexed().map((r) => r.id));
  const resolvable = new Map<string, RawSection>();
  for (const anchor of anchors) {
    const section = rows.get(anchor);
    if (section && indexed.has(section.rootId)) resolvable.set(anchor, section);
  }

  const pageRows = new PageRows(db);
  const slots = includeSubtree ? expandSubtrees(anchors, resolvable, pageRows) : anchors;

  /**
   * Valve 2, BEFORE any content is read. The prefix is taken in output order —
   * explicit anchors first, each subtree spliced in behind its parent — which is
   * a hybrid order, so unlike `get_page_outline`'s prefix it carries no
   * "no orphaned node" guarantee: for `[child, parent]` the parent's subtree is
   * not contiguous, and a cut can keep a child whose parent never made it in.
   */
  const capped = slots.length > MAX_SECTION_ITEMS_PER_RESPONSE;
  const kept = capped ? slots.slice(0, MAX_SECTION_ITEMS_PER_RESPONSE) : slots;

  const items: GetSectionsItem[] = [];
  // Text truncation of one oversized body is a DIFFERENT cut from the response
  // budget dropping later items, and the caller needs telling about both: the
  // item carries the flag, the envelope carries the instruction.
  const textHints: string[] = [];
  /**
   * Edges parked OUT of the item until the budget has spoken.
   *
   * They ride along only on a `truncated` item (0.2.16), and the budget prices
   * an item by its serialized length — so an item that will ship without edges
   * must not be priced with them, or a full-bodied section pays for a payload
   * the caller never receives. Every entry here was parsed from the whole OWN
   * body, before any text clipping, which is what makes a meta-only item still
   * report everything its section embeds — and nothing its children do.
   */
  const edgesByAnchor = new Map<string, SectionEdges>();
  const pageBodies = new Map<string, Promise<string>>();
  for (const slot of kept) {
    const anchor = typeof slot === 'string' ? slot : slot.anchor;
    const section = typeof slot === 'string' ? (rows.get(slot) ?? null) : slot;
    if (!section) {
      items.push({ anchor, ...itemError(sectionNotFound(anchor, nearbyAnchors(db))) });
      continue;
    }
    /**
     * The de-indexed root, demoted from a throw to a per-item error. In a batch
     * a throw would let one de-indexed root suppress every other section the
     * caller asked for, which contradicts the rule that makes this operation
     * worth having.
     *
     * The remedy travels WITH the error. Both tool descriptions promise that
     * this variant "points at get_page", and a promise kept only in the
     * description is not kept: the caller reads the item, not the manual. The
     * pointer is followable by construction — the root has no section index, so
     * get_page is exactly the operation that serves it (with `range`, even).
     */
    if (!indexed.has(section.rootId)) {
      items.push({
        anchor,
        error:
          `section '${anchor}' is on root '${section.rootId}', which has no section index — ` +
          `read it with get_page({ rootId: "${section.rootId}", path: "${section.pagePath}" })`,
        code: 'SECTION_NOT_FOUND',
      });
      continue;
    }
    // One read per PAGE, not per section: a subtree expansion is many sections
    // of one file.
    const key = `${section.rootId}\0${section.pagePath}`;
    let body = pageBodies.get(key);
    if (!body) {
      body = pages.readBody(section.rootId, section.pagePath);
      pageBodies.set(key, body);
    }
    const fetched = fetchOne(db, await body, section);
    items.push(fetched.item);
    edgesByAnchor.set(anchor, fetched.edges);
    if (fetched.hint) textHints.push(fetched.hint);
  }

  const budgeted = applyItemBudget(items, (item) => metaOnly(item, edgesByAnchor), RETRY_HINT);
  const messages = [
    ...(capped ? [ITEM_CAP_HINT] : []),
    ...(budgeted.truncated ? [budgeted.truncationHint ?? RETRY_HINT] : []),
    ...textHints.slice(0, 1),
  ];
  return {
    results: budgeted.items,
    ...(messages.length ? { truncated: true, message: messages.join(' ') } : {}),
  };
}

/**
 * The output order of a subtree-expanded call: the explicit anchors in input
 * order, and behind each one its subtree in document order.
 *
 * Global de-duplication, FIRST occurrence wins: an anchor that is both requested
 * and inside another requested anchor's subtree sits at its own input position,
 * never at the expansion's — the set is seeded with every explicit anchor before
 * any subtree is walked. Two consequences the caller can observe: a parent and
 * its child both named in `anchors[]` yield exactly one item each, and for
 * `[child, parent]` the parent's expansion skips the child, so its subtree is
 * not contiguous.
 *
 * An unresolvable anchor stays a slot of its own (it becomes an error item and
 * counts toward the ceiling); it just has nothing to expand. The walk is over
 * `section_index` rows, not page text: the rows are what the batch is keyed
 * from, so an index-derived answer cannot disagree with the items being
 * assembled, and it costs no page read. A section is inside the subtree while
 * its heading is DEEPER than the parent's; the first row at the same or a
 * shallower level ends it.
 */
function expandSubtrees(
  anchors: readonly string[],
  resolvable: ReadonlyMap<string, RawSection>,
  pageRows: PageRows,
): Array<string | RawSection> {
  const seen = new Set(anchors);
  const slots: Array<string | RawSection> = [];
  for (const anchor of anchors) {
    slots.push(anchor);
    const parent = resolvable.get(anchor);
    if (!parent) continue;
    const page = pageRows.of(parent);
    const start = page.findIndex((s) => s.anchor === parent.anchor);
    if (start === -1) continue;
    for (let i = start + 1; i < page.length; i++) {
      const row = page[i]!;
      if (row.headingLevel <= parent.headingLevel) break;
      if (seen.has(row.anchor)) continue;
      seen.add(row.anchor);
      slots.push(row);
    }
  }
  return slots;
}

/** The section rows of a page, read once per page however many anchors land on it. */
class PageRows {
  private readonly byPage = new Map<string, RawSection[]>();
  constructor(private readonly db: Database) {}
  of(section: RawSection): RawSection[] {
    const key = `${section.rootId}\0${section.pagePath}`;
    let page = this.byPage.get(key);
    if (!page) {
      page = selectSections(this.db, 'WHERE rootId = ? AND page_path = ?', [section.rootId, section.pagePath]);
      this.byPage.set(key, page);
    }
    return page;
  }
}

const RETRY_HINT =
  'response budget reached — every item after the first oversized one came back without its `body` (coordinates kept, `edges` added, `truncated: true`). Pick the anchors you actually need out of those `edges` and retry as a smaller subset.';

/**
 * The ceiling's message, and what it must NOT say.
 *
 * Items past the ceiling are not in the response at all, so their anchors are
 * invisible to the caller — a "retry with a smaller subset" here would name a
 * call that returns the same thing, because the caller cannot know what to
 * leave out. The way on is the operation that lists a subtree's anchors without
 * reading it, and from there back to this one with the anchors chosen.
 */
const ITEM_CAP_HINT =
  `item ceiling reached — the subtree expansion produced more than ${MAX_SECTION_ITEMS_PER_RESPONSE} sections and only the first ${MAX_SECTION_ITEMS_PER_RESPONSE} in output order came back; the rest are absent, not truncated. Do not retry with fewer anchors (you cannot see what is missing): list the subtree's anchors with get_page_outline({ rootId, path }) and read the ones you need with get_sections({ anchors }).`;

/**
 * Serializes ONE section over page content the caller has already read.
 *
 * Returns the remediation `hint` alongside the item rather than embedding it:
 * the item shape lost `truncationHint` in 0.2.5, and the envelope's `message` is
 * where the instruction now lives. Dropping it on the floor would leave a
 * `truncated: true` item with nothing saying what to do about it.
 */
function fetchOne(
  db: Database,
  pageContent: string,
  section: RawSection,
): { item: SectionResultItem; edges: SectionEdges; hint?: string } {
  const hydrated = hydrateSectionFrom(db, pageContent, section);
  // The section serializer IS the source for this operation — the core does not
  // hand-roll a second section shape beside it. What it does own is the WIRE
  // naming: the operation's contract is snake_case, while the serializer's
  // camelCase is what the editor and every existing consumer already compile
  // against. Projecting here keeps one source of truth without renaming a
  // shipped shape out from under its consumers.
  //
  // 0.2.23 — a direct call, not a dispatch through the engine. `section` rode
  // the entity serializer's view registry as a pseudo-type; with the views gone
  // that registry has one caller and one shape, so the indirection was carrying
  // nothing.
  const detail = serializeSection(hydrated) as Record<string, unknown>;
  const edges = (detail.edges as SectionEdges | undefined) ?? hydrated.edges;

  /**
   * A single body over the whole budget is truncated as TEXT rather than
   * dropped. `applyItemBudget` never degrades the first item, so without this
   * one huge section would come back meta-only with no smaller subset left to
   * ask for — a dead end where the pre-batch operation gave a usable answer.
   *
   * The hint used to offer "the page window with get_page" as the first remedy.
   * A section only ever exists on a section-indexed root, and that is precisely
   * where get_page refuses `range` — so the page-window half was unfollowable
   * on every input that could reach this line. Narrowing to a child section is
   * the remedy that actually exists here.
   */
  const budgeted = truncateText(
    String(detail.body ?? hydrated.body),
    `section body truncated by response budget — narrow to a child section via get_page_outline({ rootId: "${section.rootId}", path: "${section.pagePath}" }), then get_sections({ anchors })`,
  );

  /**
   * The text-clipped first item keeps its `body` AND gets `edges` — the two are
   * not alternatives. Its tail is invisible, so the edges are the only way to
   * learn what the part that did not fit points at. The condition is the
   * `truncated` flag, never `body === undefined`.
   *
   * `line_end` is the end of the OWN body, not the indexed range: the index
   * keeps the subtree range because the write side lives off it, while this
   * item's coordinates describe the text it carries.
   */
  return {
    item: {
      anchor: section.anchor,
      rootId: section.rootId,
      page_path: section.pagePath,
      heading_text: section.headingText,
      heading_level: section.headingLevel,
      line_start: section.lineStart,
      line_end: ownBodyEnd(pageContent.split('\n'), section),
      body: budgeted.text,
      ...(budgeted.truncated ? { truncated: true, edges } : {}),
    },
    edges,
    ...(budgeted.truncationHint ? { hint: budgeted.truncationHint } : {}),
  };
}

function itemError(err: DiscoveryError): { error: string; code: DiscoveryErrorCode } {
  return { error: err.message, code: err.code };
}

function nearbyAnchors(db: Database): string[] {
  const near = db
    .prepare('SELECT anchor FROM section_index ORDER BY anchor LIMIT 12')
    .all() as Array<{ anchor: string }>;
  return near.map((r) => r.anchor);
}

/**
 * Strips the expensive half, keeping everything that says what was cut.
 *
 * The edges come BACK here rather than surviving from the un-degraded item:
 * they were parked outside it so the budget would price the item as it ships.
 * They describe the whole own body, not the fragment that fit — a meta-only
 * item has no fragment at all, and still reports everything the section embeds.
 */
function metaOnly(item: GetSectionsItem, edgesByAnchor: ReadonlyMap<string, SectionEdges>): GetSectionsItem {
  if (!isResultItem(item)) return item;
  const { body: _body, ...rest } = item;
  const edges = edgesByAnchor.get(item.anchor);
  return { ...rest, truncated: true, ...(edges ? { edges } : {}) };
}

/**
 * Which of the two item variants this is. Keyed on what the error item carries,
 * because since 0.2.16 both of the result item's own distinguishing fields
 * (`body`, `edges`) are optional and a meta-only item has neither.
 */
function isResultItem(item: GetSectionsItem): item is SectionResultItem {
  return !('error' in item);
}

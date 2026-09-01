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
import { bodySize, hydrateSection } from '../section-hydrator.js';
import { applyItemBudget, DEFAULT_BUDGET_CHARS, MAX_ANCHORS_PER_CALL, truncateText } from '../budget.js';
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
 * serializes exactly one section, and this loop calls it once per anchor. A
 * serializer that knew about lists would be a second definition of what a
 * section is.
 *
 * Four rules, in the order they are applied — the order matters, because
 * coverage has to be known before anything is fetched (or the covered bodies
 * are read and thrown away), and budget has to be applied before `truncated` is
 * propagated (or a covered item inherits a flag its parent does not have yet).
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
   * Which anchors can actually produce a body — resolved BEFORE coverage, not
   * after. `coveredBy` is a pointer at another item's body, so pointing it at an
   * anchor that turns out to be an error item would report a section's
   * unavailability as "your body is upstream", which is the one thing that
   * pointer must never say. A de-indexed root takes its whole page down
   * together, so nothing on it can cover anything either.
   */
  const indexed = new Set(roots.sectionIndexed().map((r) => r.id));
  const resolvable = new Map<string, RawSection>();
  for (const anchor of anchors) {
    const section = rows.get(anchor);
    if (section && indexed.has(section.rootId)) resolvable.set(anchor, section);
  }

  const coveredBy = includeSubtree ? computeCoverage(db, anchors, resolvable) : new Map<string, string>();

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
   * the caller never receives. Every entry here was parsed from the WHOLE
   * section, before any text clipping, which is what makes a meta-only item
   * still report everything its section embeds.
   */
  const edgesByAnchor = new Map<string, SectionEdges>();
  for (const anchor of anchors) {
    const cover = coveredBy.get(anchor);
    if (cover) {
      items.push({ anchor, coveredBy: cover });
      continue;
    }
    const section = rows.get(anchor) ?? null;
    if (!section) {
      items.push({ anchor, ...itemError(sectionNotFound(anchor, nearbyAnchors(db))) });
      continue;
    }
    /**
     * A section on a root that has LOST its section index is not addressable —
     * the same gate `get_section` applied, but demoted from a throw to a
     * per-item error. In a batch a throw would let one de-indexed root suppress
     * every other section the caller asked for, which contradicts the rule that
     * makes this operation worth having.
     *
     * The remedy travels WITH the error. Both tool descriptions promise that
     * this variant "points at get_page", and a promise kept only in the
     * description is not kept: the caller reads the item, not the manual. The
     * pointer is followable by construction — the root has no section index, so
     * get_page is exactly the operation that serves it (with `range`, even).
     */
    if (!resolvable.has(anchor)) {
      items.push({
        anchor,
        error:
          `section '${anchor}' is on root '${section.rootId}', which has no section index — ` +
          `read it with get_page({ rootId: "${section.rootId}", path: "${section.pagePath}" })`,
        code: 'SECTION_NOT_FOUND',
      });
      continue;
    }
    const fetched = await fetchOne(db, pages, section, includeSubtree);
    items.push(fetched.item);
    edgesByAnchor.set(anchor, fetched.edges);
    if (fetched.hint) textHints.push(fetched.hint);
  }

  const budgeted = applyItemBudget(items, (item) => metaOnly(item, edgesByAnchor), RETRY_HINT);
  const messages = [
    ...(budgeted.truncated ? [budgeted.truncationHint ?? RETRY_HINT] : []),
    ...textHints.slice(0, 1),
  ];
  return {
    results: propagateTruncation(budgeted.items),
    ...(messages.length ? { truncated: true, message: messages.join(' ') } : {}),
  };
}

const RETRY_HINT =
  'response budget reached — every item after the first oversized one came back without its `body` (coordinates kept, `edges` added, `truncated: true`). Pick the anchors you actually need out of those `edges` and retry as a smaller subset.';

/**
 * Serializes ONE section, exactly as the pre-batch operation did.
 *
 * Returns the remediation `hint` alongside the item rather than embedding it:
 * the item shape lost `truncationHint` in 0.2.5, and the envelope's `message` is
 * where the instruction now lives. Dropping it on the floor would leave a
 * `truncated: true` item with nothing saying what to do about it.
 */
async function fetchOne(
  db: Database,
  pages: PageSource,
  section: RawSection,
  includeSubtree: boolean,
): Promise<{ item: SectionResultItem; edges: SectionEdges; hint?: string }> {
  const hydrated = await hydrateSection(db, pages, section, includeSubtree);
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
   */
  return {
    item: {
      anchor: section.anchor,
      rootId: section.rootId,
      page_path: section.pagePath,
      heading_text: section.headingText,
      heading_level: section.headingLevel,
      line_start: section.lineStart,
      line_end: section.lineEnd,
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
 * Which requested anchors fall inside another requested anchor's subtree.
 *
 * Derived from `section_index`, NOT from re-scanning page text the way
 * `sliceBody(includeSubtree)` does. Both answer the same question, but the rows
 * are what the batch was keyed from, so an index-derived answer cannot disagree
 * with the items being assembled — and it needs no page read at all. A section
 * is inside `covering`'s subtree while its heading is DEEPER than covering's;
 * the first row at the same or shallower level ends the subtree.
 *
 * Ties are resolved by input order: the first requested anchor that covers
 * another wins, so `coveredBy` is stable regardless of page layout.
 *
 * `rows` holds only the RESOLVABLE anchors — one that will end up an error item
 * must not appear on either side of the relation.
 */
function computeCoverage(
  db: Database,
  anchors: readonly string[],
  rows: ReadonlyMap<string, RawSection>,
): Map<string, string> {
  const byPage = new Map<string, RawSection[]>();
  const covered = new Map<string, string>();

  for (const anchor of anchors) {
    const section = rows.get(anchor);
    if (!section) continue;
    const key = `${section.rootId}\0${section.pagePath}`;
    if (!byPage.has(key)) {
      byPage.set(key, selectSections(db, 'WHERE rootId = ? AND page_path = ?', [section.rootId, section.pagePath]));
    }
  }

  const requested = new Set(anchors);
  for (const anchor of anchors) {
    const covering = rows.get(anchor);
    if (!covering || covered.has(anchor)) continue;
    const page = byPage.get(`${covering.rootId}\0${covering.pagePath}`) ?? [];
    const start = page.findIndex((s) => s.anchor === covering.anchor);
    if (start === -1) continue;
    for (let i = start + 1; i < page.length; i++) {
      const row = page[i]!;
      if (row.headingLevel <= covering.headingLevel) break;
      if (requested.has(row.anchor) && !covered.has(row.anchor)) covered.set(row.anchor, anchor);
    }
  }

  /**
   * Collapse chains to the OUTERMOST coverer. Containment is transitive, but the
   * loop above is first-writer-wins per covered anchor, so an intermediate
   * section can claim a deeper one and then itself be claimed by a shallower
   * ancestor — leaving `#### Grand -> ### Child` where `### Child` has no body of
   * its own. Following that pointer lands on nothing, which is exactly what the
   * `coveredBy`-without-`truncated` guarantee forbids. The walk terminates
   * because each hop is strictly shallower than the last.
   */
  const resolved = new Map<string, string>();
  for (const [anchor, cover] of covered) {
    let outermost = cover;
    while (covered.has(outermost)) outermost = covered.get(outermost)!;
    resolved.set(anchor, outermost);
  }
  return resolved;
}

/**
 * Strips the expensive half, keeping everything that says what was cut.
 *
 * The edges come BACK here rather than surviving from the un-degraded item:
 * they were parked outside it so the budget would price the item as it ships.
 * They describe the whole section, not the fragment that fit — a meta-only item
 * has no fragment at all, and still reports everything the section embeds.
 */
function metaOnly(item: GetSectionsItem, edgesByAnchor: ReadonlyMap<string, SectionEdges>): GetSectionsItem {
  if (!isResultItem(item)) return item;
  const { body: _body, ...rest } = item;
  const edges = edgesByAnchor.get(item.anchor);
  return { ...rest, truncated: true, ...(edges ? { edges } : {}) };
}

/**
 * Which of the three item variants this is. Keyed on what the OTHER two carry,
 * because since 0.2.16 both of the result item's own distinguishing fields
 * (`body`, `edges`) are optional and a meta-only item has neither.
 */
function isResultItem(item: GetSectionsItem): item is SectionResultItem {
  return !('coveredBy' in item) && !('error' in item);
}

/**
 * A `coveredBy` item promises its body lives in the covering item. When that one
 * was cut, the promise is void — so the flag travels down, and `coveredBy`
 * WITHOUT `truncated` stays a guarantee rather than a hopeful pointer.
 */
function propagateTruncation(items: readonly GetSectionsItem[]): GetSectionsItem[] {
  const truncatedAnchors = new Set(
    items.filter(isResultItem).filter((i) => i.truncated).map((i) => i.anchor),
  );
  if (!truncatedAnchors.size) return [...items];
  return items.map((item) =>
    'coveredBy' in item && truncatedAnchors.has(item.coveredBy) ? { ...item, truncated: true } : item,
  );
}

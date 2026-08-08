/**
 * M39 — `list_sections` and `get_sections`.
 *
 * `list_sections` takes a DISCRIMINATED UNION, `{ by: "page" }` or
 * `{ by: "anchor" }`, replacing three optional flags that were silently ANDed
 * and quietly ignored each other. The fuzzy `query` mode is gone on purpose: it
 * mixed identity regimes — a heading substring is not an identity — and leaked
 * search into what is a traversal. The replacement path is explicit:
 * `search_pages` to find a hit, then `list_sections({ by: "anchor" })`.
 *
 * Sections exist only on roots with `sectionIndexed`, so both operations
 * iterate that subset. There is no `rootId === 'pages'` branch anywhere here.
 */

import type { Database } from 'better-sqlite3';
import type { DiscoveryError, DiscoveryErrorCode } from '../errors.js';
import { invalidArgument, sectionNotFound } from '../errors.js';
import type { PageSource } from '../page-source.js';
import { DEFAULT_LIMITS, paginate } from '../pagination.js';
import type { RawEntityReader, RawSection } from '../raw-entity-reader.js';
import type { RootSet } from '../roots.js';
import type { SerializationEngine } from '../../core/plugin-host/serialization-engine.js';
import { bodySize, hydrateSection } from '../section-hydrator.js';
import { applyItemBudget, MAX_ANCHORS_PER_CALL, truncateText } from '../budget.js';
import type {
  GetSectionsInput,
  GetSectionsItem,
  GetSectionsResult,
  ListSectionsInput,
  ListSectionsResult,
  SectionListItem,
  SectionResultItem,
} from '../types.js';

/** The indexer's own anchor alphabet — an anchor is `[a-z0-9]{6,12}`, nothing else. */
const ANCHOR_RE = /^[a-z0-9]{6,12}$/;

export async function listSections(
  db: Database,
  pages: PageSource,
  roots: RootSet,
  input: ListSectionsInput,
): Promise<ListSectionsResult> {
  if (input.by !== 'page' && input.by !== 'anchor') {
    throw invalidArgument(
      'list_sections requires a `by` discriminator',
      'list_sections({ by: "page", rootId, path }) or list_sections({ by: "anchor", anchor })',
    );
  }

  let rows: RawSection[];
  if (input.by === 'anchor') {
    if (!ANCHOR_RE.test(input.anchor ?? '')) {
      throw invalidArgument(
        `'${input.anchor ?? ''}' is not an anchor`,
        'an anchor is 6-12 lowercase alphanumerics; use search_pages to find one by text',
      );
    }
    rows = selectSections(db, 'WHERE anchor = ?', [input.anchor]);
  } else {
    const root = roots.requireSectionIndexed(input.rootId, 'list_sections');
    /**
     * A missing `path` is refused rather than answered. `page_path = NULL`
     * matches no row, so without this the call comes back "that page has no
     * sections" for a call that never named a page — the caller cannot tell an
     * unsectioned page from its own omission, and every sibling operation
     * (`get_page`, `search_pages`, `find_references({ target: "page" })`)
     * refuses the same shape.
     */
    if (!input.path) {
      throw invalidArgument(
        'list_sections({ by: "page" }) requires path',
        `list_sections({ by: "page", rootId: "${root.id}", path: "<relative path>" }) — use list_pages({ rootId: "${root.id}" }) to see them`,
      );
    }
    rows = selectSections(db, 'WHERE rootId = ? AND page_path = ?', [root.id, input.path]);
  }

  const indexed = new Set(roots.sectionIndexed().map((r) => r.id));
  const visible = rows.filter((r) => indexed.has(r.rootId));
  // Measurement before fetching is a contract, not a nicety: three of five
  // failures in the motivating session were pulling something unbounded. Each
  // page is read ONCE for the whole group, not once per section.
  const sizes = await measure(pages, visible);

  const items: SectionListItem[] = visible.map((section) => ({
    rootId: section.rootId,
    anchor: section.anchor,
    heading: section.headingText,
    level: section.headingLevel,
    headingPath: section.headingPath ? section.headingPath.split('/') : [],
    size: sizes.get(section.anchor) ?? 0,
  }));

  items.sort((a, b) => a.rootId.localeCompare(b.rootId) || a.anchor.localeCompare(b.anchor));
  const page = paginate(items, input, DEFAULT_LIMITS.listSections);
  /**
   * An anchor lookup answers whether the anchor EXISTS, not only what it points
   * at: an empty list would otherwise be indistinguishable from a page with no
   * sections, and an agent that cannot tell those apart retries the wrong fix.
   *
   * Existence is asked of `rows`, NOT of the root-filtered `visible`. An anchor
   * indexed on a root that has since lost `sectionIndexed` is still a real
   * anchor — reporting `is_known: false` there would say "no such anchor" about
   * one `get_sections` resolves, and the two answers would contradict each other
   * about the same string.
   */
  return input.by === 'anchor' ? { ...page, is_known: rows.length > 0 } : page;
}

async function measure(pages: PageSource, sections: readonly RawSection[]): Promise<Map<string, number>> {
  const byPage = new Map<string, RawSection[]>();
  for (const s of sections) {
    const key = `${s.rootId}:${s.pagePath}`;
    const group = byPage.get(key);
    if (group) group.push(s);
    else byPage.set(key, [s]);
  }
  const sizes = new Map<string, number>();
  for (const group of byPage.values()) {
    const first = group[0]!;
    let content: string;
    try {
      content = await pages.readBody(first.rootId, first.pagePath);
    } catch {
      // An index row whose page is gone still lists — with size 0 rather than
      // taking the whole listing down over one stale row.
      continue;
    }
    for (const s of group) sizes.set(s.anchor, bodySize(content, s));
  }
  return sizes;
}

export function selectSections(db: Database, where: string, params: unknown[]): RawSection[] {
  const rows = db
    .prepare(`SELECT * FROM section_index ${where} ORDER BY page_path, line_start`)
    .all(...(params as never[])) as Array<Record<string, unknown>>;
  return rows.map(toRawSection);
}

export function toRawSection(row: Record<string, unknown>): RawSection {
  return {
    rootId: row.rootId as string,
    anchor: row.anchor as string,
    pagePath: row.page_path as string,
    headingPath: row.heading_path as string,
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
 * The batching lives HERE and nowhere below: the `detail` view (M06) still
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
  serialization: SerializationEngine,
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
    const fetched = await fetchOne(db, pages, reader, serialization, section, includeSubtree);
    items.push(fetched.item);
    if (fetched.hint) textHints.push(fetched.hint);
  }

  const budgeted = applyItemBudget(items, metaOnly, RETRY_HINT);
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
  'response budget reached — every item after the first oversized one came back without its `body` (coordinates and edges kept, `truncated: true`). Retry those anchors as a smaller subset.';

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
  reader: RawEntityReader,
  serialization: SerializationEngine,
  section: RawSection,
  includeSubtree: boolean,
): Promise<{ item: SectionResultItem; hint?: string }> {
  const hydrated = await hydrateSection(db, pages, section, includeSubtree);
  // The `detail` view IS the source for this operation — the core does not
  // hand-roll a second section shape beside the serializer's. What it does own
  // is the WIRE naming: the operation's contract is snake_case, while the
  // serializer's camelCase is what the editor and every existing consumer of
  // `single_element` already compile against. Projecting here keeps one source
  // of truth without renaming a shipped shape out from under its consumers.
  const detail = serialization.serializeSection('detail', hydrated, reader).data as Record<string, unknown>;
  const edges = (detail.edges as SectionResultItem['edges']) ?? hydrated.edges;

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
    `section body truncated by response budget — narrow to a child section via list_sections({ by: "page", rootId: "${section.rootId}", path: "${section.pagePath}" }), then get_sections({ anchors })`,
  );

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
      ...(budgeted.truncated ? { truncated: true } : {}),
      edges,
    },
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

/** Strips the expensive half, keeping everything that says what was cut. */
function metaOnly(item: GetSectionsItem): GetSectionsItem {
  if (!('body' in item)) return item;
  const { body: _body, ...rest } = item as SectionResultItem;
  return { ...rest, truncated: true };
}

/**
 * A `coveredBy` item promises its body lives in the covering item. When that one
 * was cut, the promise is void — so the flag travels down, and `coveredBy`
 * WITHOUT `truncated` stays a guarantee rather than a hopeful pointer.
 */
function propagateTruncation(items: readonly GetSectionsItem[]): GetSectionsItem[] {
  const truncatedAnchors = new Set(
    items.filter((i) => 'body' in i || 'edges' in i).filter((i) => i.truncated).map((i) => i.anchor),
  );
  if (!truncatedAnchors.size) return [...items];
  return items.map((item) =>
    'coveredBy' in item && truncatedAnchors.has(item.coveredBy) ? { ...item, truncated: true } : item,
  );
}

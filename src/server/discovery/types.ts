/**
 * M39 — the discovery core's contract.
 *
 * Fourteen read-only operations with one pagination semantic, one budget, one
 * sort determinism and one error catalogue. Transports (the CLI, the stdio MCP
 * server, the in-process tool servers, the chat agent) map names and protocol
 * onto these; they do not define behaviour, and they may NARROW the exposed set
 * but never widen it.
 *
 * Two structural rules show up all over these types:
 *
 * - **Identity is a discriminated union, never a guess about a string's shape.**
 *   A page is `(rootId, path)`, a section is an `anchor`, an entity is
 *   `(type, slug)`, a tag is a name. Polymorphic operations take an explicit
 *   discriminator (`by`, `target`); a call without one is an `INVALID_ARGUMENT`
 *   that lists the variants rather than defaulting to the most common case.
 * - **Read-only from a hard boundary.** There is no mutating operation here and
 *   no route to one. Writes stay in M13 (entities) and M02 (pages).
 */

import type { Database } from 'better-sqlite3';
import type { Root } from '../../shared/types.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import type { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import type { ViewKind } from '../serialization/types.js';
import type { RawEntityReader } from './raw-entity-reader.js';
import type { Page } from './pagination.js';
import type { DiscoveryErrorCode } from './errors.js';

/**
 * Everything the core needs, ALREADY RESOLVED. Resolving a project, a
 * workspace and a db slot is the transport's job — the core is handed a handle
 * and a root list and never learns how they were found.
 */
export interface DiscoveryDeps {
  reader: RawEntityReader;
  db: Database;
  host: ProjectPluginHost;
  serialization: SerializationEngine;
  roots: readonly Root[];
  /** Absolute path of the project directory; page roots are resolved under it. */
  projectDir: string;
  packageVersion: string;
}

// ── Meta ────────────────────────────────────────────────────────────────────

export interface OverviewRoot {
  id: string;
  name: string;
  sectionIndexed: boolean;
  referenceValidated: boolean;
  pageCount: number;
}

export interface OverviewType {
  count: number;
  payloadVersion: number;
  description: string;
  roleNoun: string;
  mcpToolsLine?: string;
}

export interface OverviewResult {
  roots: OverviewRoot[];
  types: Record<string, OverviewType>;
  tagCount: number;
  claude4spec: string;
}

export interface DescribeTypesInput {
  types?: string[];
  view?: ViewKind;
}

export interface DescribedType {
  type: string;
  label: string;
  payloadVersion: number;
  /** Every view kind — a type answers all five, computing some, generating the rest. */
  views: ViewKind[];
  schemas: Record<string, unknown>;
  /** The paths a `search_entities` call would actually cover for this type. */
  searchableFields: string[];
}

export interface DescribeTypesResult {
  types: DescribedType[];
}

// ── Pages and sections ──────────────────────────────────────────────────────

export interface ListPagesInput {
  rootId: string;
  prefix?: string;
  sort?: 'path' | 'modified';
  limit?: number;
  offset?: number;
}

export interface PageListItem {
  rootId: string;
  path: string;
  title: string;
  sectionCount: number;
  size: number;
  mtime: string;
}

export type ListPagesResult = Page<PageListItem>;

export type ListSectionsInput = ({ by: 'page'; rootId: string; path: string } | { by: 'anchor'; anchor: string }) & {
  limit?: number;
  offset?: number;
};

export interface SectionListItem {
  rootId: string;
  anchor: string;
  heading: string;
  level: number;
  headingPath: string[];
  /** Bytes of body — measurement before fetching, part of the contract. */
  size: number;
}

/**
 * `is_known` is present only for the `by: "anchor"` variant, and it is part of
 * the contract rather than a convenience: an empty list from an anchor lookup
 * means "this well-formed anchor is not in the index", which is a different fact
 * from "this page has no sections", and a caller cannot tell them apart from
 * `total: 0` alone. It lives here rather than in each transport because a
 * transport that had to derive it would be defining behaviour.
 */
export type ListSectionsResult = Page<SectionListItem> & { is_known?: boolean };

/**
 * 0.2.5 — `get_sections` takes a LIST. One anchor is a list of one.
 *
 * Every path that produces an anchor produces several: `search_pages` hits,
 * `find_references` referents, a pick out of `list_sections`. Fetching them one
 * at a time is the N+1 the minimal `list_entities` view already removed once —
 * except over stdio the cost is model turns, not I/O. `includeSubtree` was never
 * the answer to it: a subtree covers ADJACENT sections, and search hits are
 * scattered across pages.
 *
 * `includeSubtree` stays a flag of the whole call rather than of each anchor.
 * Per-anchor granularity would let one call mix two definitions of what a
 * section is, and the caller can always split the call instead.
 */
export interface GetSectionsInput {
  anchors: string[];
  includeSubtree?: boolean;
}

export interface SectionEdges {
  sectionRefs: Array<{ anchor: string; raw: string; line: number }>;
  entityEmbeds: Array<{
    tagType: string;
    type: string;
    slug?: string;
    slugs?: string[];
    tags?: string[];
    filter?: string;
    raw: string;
    line: number;
  }>;
  pageLinks: Array<{ rootId: string; path: string; anchor?: string; raw: string; line: number }>;
}

/**
 * The section itself. `body` is OPTIONAL because a budget cut degrades an item
 * to meta-only rather than dropping it: the coordinates and the edges are the
 * cheap half and stay, so a caller can still see what it did not get and go
 * fetch it. An item with no `body` always carries `truncated: true`, which is
 * what separates "cut" from "empty section".
 */
export interface SectionResultItem {
  anchor: string;
  rootId: string;
  page_path: string;
  heading_text: string;
  heading_level: number;
  line_start: number;
  line_end: number;
  /** AS AUTHORED — XML tags untouched, because a tag is an edge. */
  body?: string;
  truncated?: boolean;
  edges: SectionEdges;
}

/**
 * An anchor that was asked for explicitly AND fell inside another requested
 * anchor's subtree. Its body is not repeated — it is already in `coveredBy`'s
 * item.
 *
 * `truncated` is inherited from the covering item when that one was cut. The
 * absence of `truncated` is therefore a GUARANTEE that the body is present
 * upstream; without the inheritance, `coveredBy` would sometimes point at an
 * item that has no body either, and the caller would follow the pointer to
 * nothing.
 */
export interface SectionCoveredItem {
  anchor: string;
  coveredBy: string;
  truncated?: boolean;
}

/**
 * A per-ITEM failure. One unknown anchor does not fail the batch — the other
 * sections still come back with their bodies, which is the whole reason the
 * operation takes a list.
 */
export interface SectionErrorItem {
  anchor: string;
  error: string;
  code: DiscoveryErrorCode;
}

export type GetSectionsItem = SectionResultItem | SectionCoveredItem | SectionErrorItem;

export interface GetSectionsResult {
  /** In input order, after silently de-duplicating anchors. */
  results: GetSectionsItem[];
  truncated?: boolean;
  /** Present only on a cut: how to fetch the remainder. */
  message?: string;
}

export interface GetPageInput {
  rootId: string;
  path: string;
  /** Line range, 1-based inclusive. Allowed ONLY on roots without a section index. */
  range?: { start: number; end: number };
}

/**
 * `truncated` + `truncationHint` are the ONLY cut signal. There is deliberately
 * no line counter beside them: the budget that does the cutting is measured in
 * CHARACTERS, so a line total is denominated in a unit unrelated to the reason
 * the content ended — worse than absent, because it invites arithmetic that
 * cannot work. Resumption goes through the document's structure
 * (`list_sections` + `get_sections`) or through an explicit line window
 * (`range`, on roots without a section index), never through a counter.
 */
export interface GetPageResult {
  rootId: string;
  path: string;
  content: string;
  truncated?: boolean;
  truncationHint?: string;
}

// ── Search ──────────────────────────────────────────────────────────────────

export interface SearchPagesInput {
  query?: string;
  regex?: string;
  rootId?: string;
  mode?: 'hits' | 'pages' | 'count';
  limit?: number;
  offset?: number;
}

export type SearchPageHit =
  | { kind: 'section'; rootId: string; anchor: string; path: string; line: number; fragment: string; score: number }
  | { kind: 'line'; rootId: string; path: string; line: number; fragment: string; score: number };

export type SearchPagesResult =
  | (Page<SearchPageHit> & { mode: 'hits' })
  | (Page<{ rootId: string; path: string; matchCount: number }> & { mode: 'pages' })
  | { mode: 'count'; total: number };

export interface SearchEntitiesInput {
  type: string;
  query: string;
  fields?: string[];
  view?: ViewKind;
  mode?: 'hits' | 'count';
  limit?: number;
  offset?: number;
  /** Same declarative field filter as `ListEntitiesInput.filters`, ANDed with the ranking. */
  filters?: Record<string, unknown>;
}

export type SearchEntitiesResult =
  | (Page<{ slug: string; score: number; data: unknown } & SerializedMeta> & {
      mode: 'hits';
      /** Mandatory: without it an empty result is indistinguishable from an out-of-scope field. */
      searchedFields: string[];
    })
  | { mode: 'count'; total: number; searchedFields: string[] };

export interface ResolveIdentityInput {
  query: string;
  types?: string[];
  /** Top-N of a ranking — see the note in `resolveIdentity`. There is no `offset`. */
  limit?: number;
}

export interface ResolveIdentityResult {
  candidates: Array<{ type: string; slug: string; label: string; score: number }>;
}

// ── Graph ───────────────────────────────────────────────────────────────────

export interface ListEntitiesInput {
  type: string;
  tags?: string[];
  filter?: 'and' | 'or';
  /**
   * 2.0.0 tier K — declarative field filter, `{ field: value | value[] }`,
   * ANDed with the tag filter. Equality / set membership over the type's own
   * declared scalar fields; see `RawEntityReader.slugsMatching` for the
   * vocabulary and why it is derived from the declaration rather than left to a
   * per-type service.
   */
  filters?: Record<string, unknown>;
  view?: ViewKind;
  mode?: 'items' | 'count';
  limit?: number;
  offset?: number;
}

/**
 * Serialization outcome, travelling with every serialized record — see
 * `serialize` in ops/entities.ts.
 *
 * `generic` (0.2.9, was `fallback`) marks a payload the HOST built from the
 * projection row rather than one the type computed. Optional on the wire on
 * purpose: it is the common case now, and stamping `generic: false` onto every
 * row of every list would pay for the rare case in every response.
 */
export interface SerializedMeta {
  generic?: boolean;
  error?: string;
  brokenRefs?: string[];
}

export type ListEntitiesResult =
  | (Page<{ slug: string; data: unknown } & SerializedMeta> & { mode: 'items' })
  | { mode: 'count'; total: number };

export interface GetEntitiesInput {
  type: string;
  slugs: string[];
  view?: ViewKind;
}

export interface GetEntitiesResult {
  type: string;
  view: ViewKind;
  results: Array<{ slug: string; entity: unknown | null; truncated?: boolean } & SerializedMeta>;
  truncated?: boolean;
  /**
   * 0.2.6 — the instruction lives HERE, not on the item.
   *
   * `get_sections` already carried its retry instruction on the envelope while
   * `get_entities` carried a `truncationHint` on its own result, so the two
   * halves of one category ("fetch by key") disagreed about where a consumer
   * should look. The item now says only THAT it was cut (`truncated: true`);
   * what to do about it is said once, for the whole call.
   */
  message?: string;
}

export interface ListTagsInput {
  withCounts?: boolean;
  minCount?: number;
  coOccurringWith?: string;
  limit?: number;
  offset?: number;
}

export interface TagListItem {
  slug: string;
  name: string;
  color: string | null;
  description: string | null;
  counts?: Record<string, number>;
  coOccurrence?: number;
}

export type ListTagsResult = Page<TagListItem>;

export type FindReferencesInput = (
  | { target: 'entity'; type: string; slug: string }
  | { target: 'section'; anchor: string }
  | { target: 'page'; rootId: string; path: string }
) & {
  includeTagMatches?: boolean;
  limit?: number;
  offset?: number;
};

export interface ReferenceHit {
  rootId: string;
  pagePath: string;
  anchor?: string;
  tagType: string;
  line: number;
  via?: string[];
}

/**
 * The rows come back under `references`, not `items`: that is the name the tool
 * contract uses, and carrying both would ship the same array twice.
 */
export interface FindReferencesResult {
  references: ReferenceHit[];
  total: number;
  hasMore: boolean;
}

// ── Keyed collections (M39 L2) ──────────────────────────────────────────────

export interface CollectionOverviewInput {
  type: string;
  slug: string;
  /** The declared field naming the keyed collection. */
  field: string;
}

export interface CollectionAxis {
  /** The item field carrying this axis's coordinate. */
  key: string;
  /** The PARENT field carrying this axis's length. */
  extent: string;
  /** That field's current value — the dimension, never a `MAX()` over stored items. */
  length: number;
}

export interface CollectionOverviewResult {
  type: string;
  slug: string;
  field: string;
  /** Always two, in declared order. The first is the outer axis of a window's rows. */
  axes: CollectionAxis[];
  /** The item's non-coordinate fields — what a cell actually carries. */
  itemFields: readonly string[];
  /** Flags declared on the collection node, as declared. */
  flags: Record<string, unknown>;
}

/**
 * A rectangle over the two axes, 1-based inclusive on both.
 *
 * `a*` is the first declared axis, `b*` the second. A full row is `a1 === a2`;
 * a full column is `b1 === b2` — degenerate windows, not separate operations.
 */
export interface CollectionWindowInput {
  type: string;
  slug: string;
  field: string;
  a1: number;
  b1: number;
  a2: number;
  b2: number;
}

export interface CollectionWindowResult {
  type: string;
  slug: string;
  field: string;
  /** The rectangle actually read, echoed so a caller can address `items` by coordinate. */
  window: Array<{ key: string; from: number; to: number }>;
  /**
   * Row-major over the first axis then the second, DENSE over the whole
   * rectangle — an unwritten coordinate materializes as the item's empty value
   * rather than being omitted, so `items[a - a1][b - b1]` always addresses the
   * cell the caller meant.
   */
  items: unknown[][];
}

export interface CheckConsistencyInput {
  severity?: 'error' | 'warning';
  rule?: string | number;
  limit?: number;
}

export interface ConsistencyReport extends Record<string, unknown> {
  summary: { total: number; errors: number; warnings: number };
}

// ── The core ────────────────────────────────────────────────────────────────

export interface DiscoveryCore {
  overview(): Promise<OverviewResult>;
  describeTypes(input?: DescribeTypesInput): DescribeTypesResult;
  listPages(input: ListPagesInput): Promise<ListPagesResult>;
  listSections(input: ListSectionsInput): Promise<ListSectionsResult>;
  getSections(input: GetSectionsInput): Promise<GetSectionsResult>;
  getPage(input: GetPageInput): Promise<GetPageResult>;
  searchPages(input: SearchPagesInput): Promise<SearchPagesResult>;
  searchEntities(input: SearchEntitiesInput): SearchEntitiesResult;
  listEntities(input: ListEntitiesInput): ListEntitiesResult;
  getEntities(input: GetEntitiesInput): GetEntitiesResult;
  listTags(input?: ListTagsInput): ListTagsResult;
  findReferences(input: FindReferencesInput): Promise<FindReferencesResult>;
  checkConsistency(input?: CheckConsistencyInput): Promise<ConsistencyReport>;
  resolveIdentity(input: ResolveIdentityInput): ResolveIdentityResult;
  /**
   * M39 L2 — the shape of a keyed collection, without materializing an item.
   * Always call this before a window: it is where the dimensions come from.
   */
  collectionOverview(input: CollectionOverviewInput): CollectionOverviewResult;
  /** M39 L2 — a rectangle of a keyed collection, 1-based inclusive on both axes. */
  collectionWindow(input: CollectionWindowInput): CollectionWindowResult;
}

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
  version: string;
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
  version: string;
  views: string[];
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

export type ListSectionsResult = Page<SectionListItem>;

export interface GetSectionInput {
  anchor: string;
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

export interface GetSectionResult {
  anchor: string;
  rootId: string;
  page_path: string;
  heading_text: string;
  heading_level: number;
  content_hash: string;
  line_start: number;
  line_end: number;
  /** AS AUTHORED — XML tags untouched, because a tag is an edge. */
  body: string;
  truncated?: boolean;
  truncationHint?: string;
  edges: SectionEdges;
}

export interface GetPageInput {
  rootId: string;
  path: string;
  /** Line range, 1-based inclusive. Allowed ONLY on roots without a section index. */
  range?: { start: number; end: number };
}

export interface GetPageResult {
  rootId: string;
  path: string;
  content: string;
  truncated?: boolean;
  truncationHint?: string;
  /** Total lines in the page — what a `range` is a window onto. */
  total: number;
  hasMore: boolean;
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
  view?: ViewKind;
  mode?: 'items' | 'count';
  limit?: number;
  offset?: number;
}

/** Serializer outcome travels with every serialized record — see `serialize` in ops/entities.ts. */
export interface SerializedMeta {
  fallback?: boolean;
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
  results: Array<{ slug: string; entity: unknown | null } & SerializedMeta>;
  truncated?: boolean;
  truncationHint?: string;
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
  getSection(input: GetSectionInput): Promise<GetSectionResult>;
  getPage(input: GetPageInput): Promise<GetPageResult>;
  searchPages(input: SearchPagesInput): Promise<SearchPagesResult>;
  searchEntities(input: SearchEntitiesInput): SearchEntitiesResult;
  listEntities(input: ListEntitiesInput): ListEntitiesResult;
  getEntities(input: GetEntitiesInput): GetEntitiesResult;
  listTags(input?: ListTagsInput): ListTagsResult;
  findReferences(input: FindReferencesInput): Promise<FindReferencesResult>;
  checkConsistency(input?: CheckConsistencyInput): Promise<ConsistencyReport>;
  resolveIdentity(input: ResolveIdentityInput): ResolveIdentityResult;
}

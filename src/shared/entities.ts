import type { TodoItem, UsageStats } from '@inharness-ai/agent-adapters';

export type { TodoItem, UsageStats };

export type EntityType = 'endpoint' | 'dto' | 'database-table' | 'ui-view' | 'ac' | 'section';
export type ChangedBy = 'user' | 'agent';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type EndpointDtoRelation = 'request' | 'response' | 'error';

export interface EndpointDtoLink {
  dtoSlug: string;
  dtoName: string;
  relation: EndpointDtoRelation;
  statusCode: number | null;
}

export interface Endpoint {
  slug: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string | null;
  tags: string[];
  dtos: EndpointDtoLink[];
  createdAt: string;
  updatedAt: string;
}

export interface EndpointCreateInput {
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
}

export interface EndpointUpdateInput {
  method?: HttpMethod;
  path?: string;
  summary?: string;
  description?: string | null;
  tags?: string[];
  newSlug?: string;
}

export interface EndpointListQuery {
  tags?: string[];
  tagFilter?: 'and' | 'or';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface EndpointDeleteResult {
  deleted: true;
  brokenReferences: BrokenReference[];
}

export interface BrokenReference {
  pagePath: string;
  tagType: string;
  line: number;
  slug?: string;
  type?: EntityType;
}

export interface DtoField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface DtoExample {
  name: string;
  summary?: string;
  value: unknown;
}

export interface DtoEndpointLink {
  endpointSlug: string;
  method: HttpMethod;
  path: string;
  relation: EndpointDtoRelation;
  statusCode: number | null;
}

export interface Dto {
  slug: string;
  name: string;
  description: string | null;
  fields: DtoField[];
  examples: DtoExample[];
  tags: string[];
  endpoints: DtoEndpointLink[];
  createdAt: string;
  updatedAt: string;
}

export interface DtoCreateInput {
  name: string;
  description?: string;
  fields?: DtoField[];
  examples?: DtoExample[];
  tags?: string[];
  /** Optional explicit slug — used by M17 restore to preserve identity (decyzja 4). */
  slug?: string;
}

export interface DtoUpdateInput {
  name?: string;
  description?: string | null;
  fields?: DtoField[];
  examples?: DtoExample[];
  tags?: string[];
  newSlug?: string;
}

export interface DtoListQuery {
  tags?: string[];
  tagFilter?: 'and' | 'or';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface DtoDeleteResult {
  deleted: true;
  brokenReferences: BrokenReference[];
}

export interface ReferenceHit {
  pagePath: string;
  tagType: string;
  line: number;
  raw: string;
}

// --- M07: Database Table ---

export interface DatabaseTableForeignKey {
  table: string;
  column: string;
}

export interface DatabaseTableColumn {
  name: string;
  type: string;
  nullable?: boolean;
  unique?: boolean;
  pk?: boolean;
  fk?: DatabaseTableForeignKey;
  default?: string;
  enumValues?: string[];
  description?: string;
}

export interface DatabaseTableIndex {
  columns: string[];
  unique?: boolean;
  name?: string;
}

export interface DatabaseTable {
  slug: string;
  name: string;
  description: string | null;
  columns: DatabaseTableColumn[];
  indexes: DatabaseTableIndex[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseTableCreateInput {
  name: string;
  description?: string;
  columns?: DatabaseTableColumn[];
  indexes?: DatabaseTableIndex[];
  slug?: string;
  tags?: string[];
}

export interface DatabaseTableUpdateInput {
  name?: string;
  description?: string | null;
  columns?: DatabaseTableColumn[];
  indexes?: DatabaseTableIndex[];
  tags?: string[];
  newSlug?: string;
}

export interface DatabaseTableListQuery {
  tags?: string[];
  tagFilter?: 'and' | 'or';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface DatabaseTableDanglingFk {
  tableSlug: string;
  columnName: string;
}

export interface DatabaseTableDeleteResult {
  deleted: true;
  brokenReferences: BrokenReference[];
  danglingFks: DatabaseTableDanglingFk[];
}

// --- UI View ---

export type UiViewParamLocation = 'path' | 'query' | 'hash';

export interface UiViewParam {
  name: string;
  in: UiViewParamLocation;
  type?: string;
  required?: boolean;
  default?: string;
  description?: string;
}

export interface UiView {
  slug: string;
  name: string;
  url: string | null;
  description: string | null;
  params: UiViewParam[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UiViewCreateInput {
  name: string;
  url?: string | null;
  description?: string;
  params?: UiViewParam[];
  slug?: string;
  tags?: string[];
}

export interface UiViewUpdateInput {
  name?: string;
  url?: string | null;
  description?: string | null;
  params?: UiViewParam[];
  tags?: string[];
  newSlug?: string;
}

export interface UiViewListQuery {
  tags?: string[];
  tagFilter?: 'and' | 'or';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface UiViewDeleteResult {
  deleted: true;
  brokenReferences: BrokenReference[];
}

export interface Tag {
  slug: string;
  name: string;
  color: string | null;
  description: string | null;
  /** Per-entity-type counts. Keys are plugin types; absent type = 0. */
  counts: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface TagCreateInput {
  name: string;
  color?: string;
  description?: string;
}

export interface TagUpdateInput {
  name?: string;
  color?: string | null;
  description?: string | null;
}

export interface VersionListItem {
  id: number;
  version: number;
  changedBy: ChangedBy;
  changeSummary: string | null;
  createdAt: string;
  /** M17: release this version was captured into. Null/absent = unreleased (release_id IS NULL). */
  releaseId?: number;
  /** M17: kind of mutation captured. Null/absent for legacy rows. */
  op?: 'create' | 'update' | 'delete';
}

export interface VersionDetail extends VersionListItem {
  entityType: EntityType;
  entityId: number;
  data: unknown;
}

// --- M17: Spec Snapshots & Releases ---

export interface Release {
  id: number;
  name: string;
  description: string;
  createdBy: ChangedBy;
  createdAt: string;
}

export interface ReleaseCountBreakdown {
  entities: Record<string, number>;     // per-type counts (endpoint, dto, ...)
  pages: number;
  total: number;
}

export interface ReleaseDetail extends Release {
  countBreakdown: ReleaseCountBreakdown;
}

/**
 * M28: body of `POST /api/releases` and the MCP `release_create` result.
 * `ReleaseDetail` plus the best-effort `git commit` outcome — `null` when
 * commit-sync is off or no repo was detected. Not persisted (no column on the
 * `release` table); present only on the synchronous create response.
 */
export interface CreateReleaseResponse extends ReleaseDetail {
  gitSync?: { status: 'committed' | 'nothing-to-commit' | 'skipped' | 'error'; message?: string } | null;
}

export interface SpecSnapshotEntityRow {
  type: string;
  slug: string;
  op: 'create' | 'update' | 'delete';
  data: unknown;
}

export interface SpecSnapshotPageRow {
  path: string;
  op: 'create' | 'update' | 'delete';
  data: unknown;
}

export interface SpecSnapshot {
  release: Release;
  serializer_versions: Record<string, string>;
  entities: SpecSnapshotEntityRow[];
  pages: SpecSnapshotPageRow[];
}

export interface RawDeltaEntityChange {
  type: string;
  slug: string;
  op: 'created' | 'deleted' | 'modified' | 'noop';
  changes?: Record<string, unknown>;
  raw?: unknown;
  _serializerVersionMismatch?: { type: string; from: string | null; to: string | null };
}

export interface PageSectionLite {
  anchor: string;
  heading: string;
  level: number;
  content: string;
  position: number;
}

export interface LineDiffLineLite {
  op: 'keep' | 'added' | 'removed';
  content: string;
}

export interface LineDiffLite {
  lines: LineDiffLineLite[];
}

export interface ModifiedSectionLite {
  anchor: string;
  heading: string;
  level: number;
  /** Mandatory in M17 decyzja 10 wariant C. */
  line_diff: LineDiffLite;
}

export interface MovedSectionLite {
  anchor: string;
  from_position: number;
  to_position: number;
}

export interface PageXmlRefLite {
  tagType: string;
  attributes: Record<string, string>;
  position: number;
}

export interface FrontmatterDiffLite {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  changed: Array<{ key: string; from: unknown; to: unknown }>;
}

export interface XmlRefsDiffLite {
  added: PageXmlRefLite[];
  removed: PageXmlRefLite[];
}

export interface RawDeltaPageChange {
  path: string;
  op: 'created' | 'deleted' | 'modified' | 'noop';
  added_sections: PageSectionLite[];
  removed_sections: PageSectionLite[];
  modified_sections: ModifiedSectionLite[];
  moved_sections: MovedSectionLite[];
  frontmatter_diff: FrontmatterDiffLite | null;
  xml_refs_diff: XmlRefsDiffLite | null;
}

export interface RawDelta {
  /** `null` = synthetic empty state (initial brief, comparing against "nothing"). */
  from: { id: number; name: string } | null;
  to: { id: number; name: string };
  entities: RawDeltaEntityChange[];
  pages: RawDeltaPageChange[];
}

// --- v0.1.13: Acceptance Criteria ---

export type AcKind = 'requirement' | 'edge-case';
export type AcStatus = 'active' | 'deprecated';

export interface AcVerifyRef {
  type: string;
  slug: string;
}

export interface AcBrokenVerify extends AcVerifyRef {
  reason: 'missing' | 'inactive' | 'unknown';
}

export interface Ac {
  slug: string;
  text: string;
  kind: AcKind;
  status: AcStatus;
  verifies: AcVerifyRef[];
  description: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** Populated by routes when verifies refs do not resolve. */
  brokenVerifies?: AcBrokenVerify[];
}

export interface AcCreateInput {
  text: string;
  kind?: AcKind;
  status?: AcStatus;
  verifies?: AcVerifyRef[];
  description?: string | null;
  tags?: string[];
  /** Optional explicit slug — used by M17 restore to preserve identity. */
  slug?: string;
}

export interface AcUpdateInput {
  text?: string;
  kind?: AcKind;
  status?: AcStatus;
  verifies?: AcVerifyRef[];
  description?: string | null;
  tags?: string[];
  newSlug?: string;
}

export interface AcListQuery {
  status?: AcStatus | 'all';
  kind?: AcKind;
  tags?: string[];
  tagFilter?: 'and' | 'or';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AcDeleteResult {
  deleted: true;
  brokenReferences: BrokenReference[];
}

// --- M06: Section Index ---

export interface SectionIndexEntry {
  id: number;
  anchor: string;
  pagePath: string;
  headingPath: string;
  headingSlug: string;
  headingLevel: number;
  headingText: string;
  contentHash: string;
  lineStart: number;
  lineEnd: number;
  paragraphCount: number;
  createdAt: string;
  updatedAt: string;
}

// --- M05: Chat & Agent ---

export type ChatRole =
  | 'user'
  | 'assistant'
  | 'tool_use'
  | 'tool_result'
  | 'user_input_request'
  | 'user_input_response';

/**
 * M21 generic context discriminator. 'chat' = default (full toolset, overlay UI).
 * 'brief' = brief editorial thread (whitelisted tools, brief-detail chrome,
 * brief_path points to FS file under briefsDir).
 * M23 'patch' = patch resolution thread — applies a patch's findings to the
 * spec. Full spec-editing toolset; patch_path points to FS file under
 * patchesDir; the patch content is injected into the system prompt.
 */
export type ChatContextType = 'chat' | 'brief' | 'patch';

export interface ChatThread {
  id: string;
  title: string | null;
  lastSessionId: string | null;
  currentTodoItems: TodoItem[] | null;
  planMode: boolean;
  usage: UsageStats | null;
  contextSize: number | null;
  planId: number | null;
  lastSeenPlanVersion: number | null;
  hasSystemPrompt: boolean;
  contextType: ChatContextType;
  briefPath: string | null;
  /** M23: FS path (relative to patchesDir) — set iff contextType='patch'. */
  patchPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatThreadMeta extends ChatThread {
  messageCount: number;
}

export type ChatMessageStatus = 'streaming' | 'complete';

export interface ChatMessage {
  id: number;
  threadId: string;
  role: ChatRole;
  content: string;
  toolName: string | null;
  toolId: string | null;
  subagentTaskId: string | null;
  planMode: boolean;
  status: ChatMessageStatus;
  usage: UsageStats | null;
  contextSize: number | null;
  createdAt: string;
}

export interface ChatSubagentTask {
  threadId: string;
  taskId: string;
  toolUseId: string | null;
  description: string;
  status: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Annotation {
  id: string;
  text: string;
  comment: string;
  page: string;
  range?: { from: number; to: number };
}

// --- M10: Plans ---

export type PlanExecuteMode = 'new-session' | 'continue';
export type PlanAction =
  | 'replace'
  | 'append'
  | 'insert_after_section'
  | 'user_edit'
  | 'system_duplicate';
export type PlanChangedBy = 'agent' | 'user' | 'system';

export interface Plan {
  id: number;
  title: string | null;
  content: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanListItem {
  id: number;
  title: string | null;
  currentVersion: number;
  threadCount: number;
  lastThreadId: string | null;
  updatedAt: string;
}

export interface PlanVersion {
  id: number;
  planId: number;
  version: number;
  content: string;
  action: PlanAction;
  actionParams: Record<string, unknown> | null;
  changeSummary: string | null;
  changedBy: PlanChangedBy;
  createdAt: string;
}

export interface PlanVersionMeta {
  version: number;
  action: PlanAction;
  actionParams: Record<string, unknown> | null;
  changeSummary: string | null;
  changedBy: PlanChangedBy;
  createdAt: string;
}

export interface BlameBlock {
  blockIndex: number;
  markdownFragment: string;
  addedInVersion: number;
}

export type PlanExecuteResult =
  | {
      mode: 'new-session';
      newThreadId: string;
      planId: number;
      firstMessage: string;
    }
  | {
      mode: 'continue';
      threadId: string;
      firstMessage: string;
    };

// --- M21: Briefs ---

export type BriefChangedBy = 'user' | 'agent' | 'filesystem';

/** Reserved frontmatter keys agent cannot mutate via update_brief. */
export const BRIEF_IMMUTABLE_FRONTMATTER_KEYS = [
  'type',
  'from_release',
  'to_release',
  'generated_at',
  'generator_version',
] as const;

export interface BriefFrontmatter {
  type: 'brief';
  /** `null` = initial brief (no previous release; `to_release` opisuje stan startowy projektu). */
  from_release: string | null;
  to_release: string;
  generated_at: string;
  generator_version: string;
  implemented?: boolean;
  [key: string]: unknown;
}

export interface Brief {
  /** Path relative to briefsDir, e.g. "v0-3-to-v0-4.md". */
  path: string;
  frontmatter: BriefFrontmatter;
  body: string;
  /** Full file content (frontmatter + body, byte-faithful). */
  content: string;
  /** sha256 hex of `content` — used for optimistic concurrency. */
  hash: string;
}

export interface BriefListItem {
  path: string;
  title: string | null;
  /** `null` = initial brief. */
  fromRelease: string | null;
  toRelease: string;
  implemented: boolean;
  generatedAt: string;
  lastModifiedAt: string | null;
}

export interface BriefCreateRequest {
  /** `null` = initial brief (no previous release to compare against). */
  fromReleaseName: string | null;
  toReleaseName: string;
  additionalPrompt?: string;
  suffix?: string;
}

export interface BriefCreateResult {
  briefPath: string;
  initialThreadId: string;
}

export interface BriefFrontmatterUpdateRequest {
  implemented?: boolean;
}

export interface BriefContentUpdateRequest {
  content: string;
  expectedHash: string;
  changeSummary?: string;
}

export interface BriefContentUpdateResult {
  newHash: string;
}

export interface BriefThreadCreateRequest {
  name?: string;
}

export interface BriefThreadSummary {
  id: string;
  title: string | null;
  updatedAt: string;
  messageCount: number;
}

// --- M23: Patches ---

/** Why a coding agent filed the patch (frontmatter `patch_kind`). */
export type PatchKind = 'drift' | 'missing' | 'incorrect' | 'clarification';

/** Resolution state — `awaiting` until the spec author resolves the patch. */
export type PatchStatus = 'awaiting' | 'completed';

/**
 * Reserved frontmatter keys — set by the terminal agent that authored the
 * patch, immutable from the claude4spec side. Only `status` is mutable.
 */
export const PATCH_IMMUTABLE_FRONTMATTER_KEYS = [
  'type',
  'brief',
  'patch_kind',
  'created_at',
  'created_by',
] as const;

export interface PatchFrontmatter {
  type: 'patch';
  /** Path of the associated brief (relative to briefsDir). Absent ⇒ resolve by filename prefix. */
  brief?: string;
  patch_kind: PatchKind;
  created_at: string;
  created_by: string;
  /** Absent is treated as `'awaiting'`. */
  status?: PatchStatus;
  [key: string]: unknown;
}

/** Response of `GET /api/patches/:path` and the result of PUT/PATCH writes. */
export interface PatchResponse {
  /** Path relative to patchesDir. */
  path: string;
  title: string;
  frontmatter: PatchFrontmatter;
  body: string;
  /** Full file content (frontmatter + body, byte-faithful). */
  content: string;
  /** sha256 hex of `content` — used for optimistic concurrency. */
  hash: string;
}

export interface PatchListItem {
  path: string;
  title: string;
  /** `null` = orphan (no resolvable brief). */
  briefPath: string | null;
  patchKind: PatchKind;
  status: PatchStatus;
  createdAt: string;
  createdBy: string;
  /** `created_at` of the latest page_version row with kind='patch'. */
  lastModified: string;
  /** Count of chat threads with context_type='patch' pointing at this patch. */
  threadCount: number;
}

export interface PatchContentUpdateRequest {
  content: string;
  expectedHash: string;
}

export interface PatchFrontmatterUpdateRequest {
  status: PatchStatus;
}

export interface PatchThreadCreateRequest {
  name?: string;
}

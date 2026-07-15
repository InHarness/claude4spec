import type { TodoItem, UsageStats } from '@inharness-ai/agent-adapters';
import type { GitCommitStatus, GitSyncField } from './git.js';

export type { TodoItem, UsageStats };

export type EntityType =
  | 'endpoint'
  | 'dto'
  | 'database-table'
  | 'ui-view'
  | 'ac'
  | 'design-system'
  | 'diagram'
  | 'section';
export type ChangedBy = 'user' | 'agent';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Response of `GET /api/entities/counts` (spec DTO `entity-counts-response`):
 * a map of entity type → row count, feeding the sidebar ELEMENTS badges so a
 * page view doesn't fetch full entity lists just to read their length.
 */
export type EntityCountsResponse = Record<string, number>;

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
  /** 0.1.96: which root the referencing page lives in. */
  rootId: string;
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
  /** v0.1.59: structural (non-tag) relation to a design-system. NULL = none. Slug, no FK. */
  designSystemSlug: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UiViewCreateInput {
  name: string;
  url?: string | null;
  description?: string;
  params?: UiViewParam[];
  /** v0.1.59: slug of the referenced design-system (no FK). undefined/null = none. */
  designSystemSlug?: string | null;
  slug?: string;
  tags?: string[];
}

export interface UiViewUpdateInput {
  name?: string;
  url?: string | null;
  description?: string | null;
  params?: UiViewParam[];
  /** v0.1.59: undefined = unchanged; null = clear; string = set (dangling allowed). */
  designSystemSlug?: string | null;
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

// --- v0.1.59: Design System ---

export type TokenTier = 'primitive' | 'semantic';

/** Best-effort vocabulary — the linter warns but never hard-validates `type`. */
export type TokenType =
  | 'color'
  | 'dimension'
  | 'fontFamily'
  | 'fontWeight'
  | 'fontSize'
  | 'lineHeight'
  | 'letterSpacing'
  | 'duration'
  | 'easing'
  | 'shadow'
  | 'opacity'
  | 'zIndex'
  | 'number'
  | 'string'
  | 'typography';

/** Token types whose `value` is a composite object (each field literal or `{alias}`). */
export const COMPOSITE_TOKEN_TYPES = ['typography', 'shadow'] as const;

/** Literal/alias string, or a composite object (typography/shadow). */
export type TokenValue = string | Record<string, string>;

export interface DesignToken {
  name: string;
  /** TokenType vocabulary, but typed loosely — linter is best-effort. */
  type: string;
  value: TokenValue;
  description?: string;
}

export interface TokenGroup {
  name: string;
  tier: TokenTier;
  tokens: DesignToken[];
}

export interface DesignModeOverride {
  token: string;
  value: TokenValue;
}

export interface DesignMode {
  name: string;
  overrides: DesignModeOverride[];
}

export interface DesignSystem {
  slug: string;
  name: string;
  description: string | null;
  groups: TokenGroup[];
  modes: DesignMode[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DesignSystemCreateInput {
  name: string;
  description?: string;
  groups?: TokenGroup[];
  modes?: DesignMode[];
  /** Optional explicit slug — used by M17 restore to preserve identity. */
  slug?: string;
  tags?: string[];
}

export interface DesignSystemUpdateInput {
  name?: string;
  description?: string | null;
  /** Full replace of the array (not per-token patch). */
  groups?: TokenGroup[];
  /** Full replace of the array (not per-mode patch). */
  modes?: DesignMode[];
  tags?: string[];
  newSlug?: string;
}

export interface DesignSystemListQuery {
  tags?: string[];
  tagFilter?: 'and' | 'or';
  search?: string;
  limit?: number;
  offset?: number;
}

/** Trimmed list row — counts computed server-side without the full token payload. */
export interface DesignSystemListItem {
  slug: string;
  name: string;
  description: string | null;
  groupCount: number;
  tokenCount: number;
  modeCount: number;
  tags: string[];
}

export interface DesignSystemDanglingUiView {
  slug: string;
}

export interface DesignSystemDeleteResult {
  deleted: true;
  brokenReferences: BrokenReference[];
  /** UI views whose `designSystemSlug` pointed at the deleted record (now dangling). */
  danglingUiViews: DesignSystemDanglingUiView[];
}

// ─── Diagram (v0.1.64 — seventh entity type) ─────────────────────────────────

/** Diagram DSL language. `d2` is a reserved slot — only `mermaid` is implemented. */
export type DiagramFormat = 'mermaid' | 'd2';

export interface Diagram {
  slug: string;
  format: DiagramFormat;
  /** Literal DSL body (no trim). May be empty — a legal placeholder state. */
  source: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DiagramCreateInput {
  /** DSL body (mermaid). Optional/empty = placeholder. */
  source?: string;
  format?: DiagramFormat;
  /**
   * Transient caption — used ONLY to seed the slug (`slugify(caption)`) when no
   * explicit `slug` is given. Never persisted on the entity (no column / file
   * field); on a page it lives solely as the `<diagram caption="…"/>` attribute.
   */
  caption?: string;
  /** Optional explicit slug — also used by M17 restore to preserve identity. */
  slug?: string;
  tags?: string[];
}

export interface DiagramUpdateInput {
  source?: string;
  format?: DiagramFormat;
  tags?: string[];
  newSlug?: string;
}

export interface DiagramListQuery {
  tags?: string[];
  tagFilter?: 'and' | 'or';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface DiagramDeleteResult {
  deleted: true;
  brokenReferences: BrokenReference[];
}

/** Resolved token value: literal string, resolved composite object, or the `unresolved` sentinel. */
export type ResolvedTokenValue = string | Record<string, string>;

/** Sentinel for an alias that cannot be resolved (cycle / missing target). Preview never crashes. */
export const UNRESOLVED_TOKEN = 'unresolved';

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

/** M34/L11: `GET /api/tags` response item shape, as named in the plugin-facing DTO. */
export type TagListItem = Tag;

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
  /** M29: slug is the sole entity identity; versions are keyed by (entityType, entitySlug, version). */
  entitySlug: string;
  data: unknown;
  /** M17: `serializer.version` at time of capture. Null/absent for legacy rows. Lets callers detect a serializer upgrade between two captured versions (see `RawDeltaEntityChange._serializerVersionMismatch`). */
  serializerVersion?: string | null;
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
 * git is off or no repo was detected. Not persisted (no column on the
 * `release` table); present only on the synchronous create response.
 */
export interface CreateReleaseResponse extends ReleaseDetail {
  gitSync?: GitSyncField<GitCommitStatus>;
}

/**
 * 0.1.124: body of `PATCH /api/releases/:idOrName`. `ReleaseDetail` plus the
 * best-effort `git commit` outcome of `commitPull()` — populated ONLY when
 * the request set `assignUnreleased: true` (the only update path that
 * triggers a git commit); a plain rename/description edit returns
 * `gitSync: null`, same as when git is off or no repo was detected.
 */
export interface UpdateReleaseResponse extends ReleaseDetail {
  gitSync?: GitSyncField<GitCommitStatus>;
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
  /** 0.1.96: which root the section's page lives in. */
  rootId: string;
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
 * 0.1.79 'ask' = read-only peer-consult thread. Forced plan-mode every turn
 * (READONLY_BUILTINS); answers without ever mutating its own spec. No
 * brief_path/patch_path; created via POST /api/threads with context_type='ask'.
 */
export type ChatContextType = 'chat' | 'brief' | 'patch' | 'ask';

export interface ChatThread {
  id: string;
  title: string | null;
  lastSessionId: string | null;
  /** M05 0.1.61: turn-1 architecture snapshot (model + reasoning config). null until the
   *  thread has a session; controls hydrate from this when session-locked. */
  initialArchitectureConfig: { model: string; architectureConfig: Record<string, unknown> } | null;
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
  /**
   * 0.1.69 Transagents: parent thread id. NULL = top-level thread (appears in
   * navigation / counters); NOT NULL = child "banka" spawned via runTransagent
   * (hidden — filtered out of every thread listing and counter).
   */
  parentThreadId: string | null;
  /** 0.1.69 Transagents: the parent's tool_use id that spawned this child (F5
   *  reconstruction key together with parent_thread_id). NULL for top-level. */
  spawnedByToolUseId: string | null;
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

// --- M05: chat message queue (composer stays unlocked during a live turn) ---

/**
 * A message waiting in a thread's queue. **Frozen wire contract** — the field
 * names must match `@inharness-ai/agent-chat`'s `QueuedMessage`, because the
 * client hydrates queue chips from them. Derived from a `chat_queued_message`
 * row: `id → String(id)`, `text = prompt`, `createdAt = created_at`.
 */
export interface QueuedMessage {
  /** `String(chat_queued_message.id)` — key for cancel/chip. */
  id: string;
  /** `chat_queued_message.prompt`; restored to the composer on abort/clear. */
  text: string;
  /** ISO timestamp of when the message was enqueued. */
  createdAt: string;
}

/** Body of `POST /api/chat/queue/:threadId` — same context as `POST /api/chat`. */
export interface QueueMessageRequest {
  prompt: string;
  annotations?: Annotation[];
  currentPage?: string | null;
}

/** Full queue snapshot after a mutation (enqueue/cancel) and carried by SSE `queue_updated`. */
export interface QueueSnapshotResponse {
  queued: QueuedMessage[];
}

/** Returned by `DELETE /api/chat/queue/:threadId` and attached to abort responses. */
export interface ClearedQueueResponse {
  clearedTexts: string[];
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

/**
 * Lightweight projection of a thread attached to a plan, served by
 * `GET /api/plans/:planId/threads`. PlanPage uses this dedicated projection
 * (not the paginated `GET /api/threads` list) so its "Used by N threads"
 * dropdown is unaffected by thread-list pagination.
 */
export interface PlanThreadItem {
  id: string;
  title: string | null;
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
  'source',
  'from_release',
  'to_release',
  'generated_at',
  'generator_version',
  // 0.1.96: brief scope — the releasable roots this brief covers. Absent/omitted
  // = whole-release scope (every releasable root). Immutable once written.
  'roots',
] as const;

/**
 * 0.1.69 brief provenance.
 *   - `release-diff` (default / legacy): self-contained brief grounded in a
 *     release diff (`from_release` → `to_release`).
 *   - `analysis`: non-self-contained brief whose grounding comes from a parent
 *     thread's analysis (passed via runTransagent(message)) rather than a
 *     release diff. Always has `to_release = null` (state relative to HEAD).
 */
export type BriefSource = 'release-diff' | 'analysis';

export interface BriefFrontmatter {
  type: 'brief';
  /** 0.1.69: brief provenance. Absent in legacy briefs ⇒ defaults to 'release-diff' at parse time. */
  source: BriefSource;
  /** `null` = initial brief (no previous release; `to_release` opisuje stan startowy projektu). */
  from_release: string | null;
  /** `null` = analysis brief — state relative to HEAD, no target release. */
  to_release: string | null;
  generated_at: string;
  generator_version: string;
  implemented?: boolean;
  /**
   * 0.1.96: brief scope — the releasable root ids this brief covers (verbatim).
   * Absent/omitted = whole-release scope (all releasable roots). Immutable
   * (see BRIEF_IMMUTABLE_FRONTMATTER_KEYS).
   */
  roots?: string[];
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
  /** 0.1.69: brief provenance ('release-diff' | 'analysis'). */
  source: string;
  /** `null` = initial brief. */
  fromRelease: string | null;
  /** `null` = analysis brief (no target release; state relative to HEAD). */
  toRelease: string | null;
  implemented: boolean;
  generatedAt: string;
  lastModifiedAt: string | null;
  /** 0.1.69 B4: count of top-level (non-banka) brief threads for this brief. */
  threadCount: number;
}

export interface BriefCreateRequest {
  /** 0.1.104: brief provenance. Defaults to 'release-diff' when absent. */
  source?: BriefSource;
  /** `null` = initial brief (no previous release to compare against). */
  fromReleaseName?: string | null;
  /** `null` = analysis brief (state relative to HEAD); required unless `source = 'analysis'`. */
  toReleaseName?: string | null;
  additionalPrompt?: string;
  suffix?: string;
  /**
   * 0.1.96: brief scope — releasable root ids to cover. Omitted/empty =
   * whole-release scope (all releasable roots). Not allowed when
   * `source = 'analysis'` (dead field once `toReleaseName = null`).
   */
  roots?: string[];
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
  /** `created_at` of the latest file_version row with kind='patch'. */
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

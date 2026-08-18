import type { TodoItem, UsageStats } from '@inharness-ai/agent-adapters';
import type { GitCommitStatus, GitSyncField } from './git.js';
import type { DiffOp } from './plugin-host/data-schema.js';

export type { TodoItem, UsageStats };
export type { DiffOp };

/**
 * An entity type id, kebab-case — plus the pseudo-type `section`, which is not
 * an entity but shares the versioning and reference surfaces.
 *
 * 0.2.11: a plain `string`, not a union, for the same reason as
 * {@link RawEntityType} on the server. The union enumerated seven types the host
 * happened to know about, three of which (`endpoint`, `dto`, `database-table`)
 * are contributed by plugins the host must not name. Nearly every use was
 * already `type as EntityType` on a string the registry had just validated, so
 * the union bought no safety — it only made plugin types unrepresentable in the
 * very APIs meant to carry them.
 */
export type EntityType = string;
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

/*
 * 0.2.11: the nine `DatabaseTable*` interfaces that stood here are GONE.
 *
 * `database-table` is contributed by an EXTERNAL plugin, so the host holding its
 * field-level schema -- columns, indexes, foreign keys, its create/update/list
 * shapes -- was the type system's version of the same privilege this release
 * removes everywhere else. The plugin owns those shapes and declares them in its
 * own `data.schema`.
 *
 * Eight of the nine had no importer anywhere in the repo. The ninth,
 * `DatabaseTable`, was used by `snapshot-to-entity.ts` to rebuild a deleted
 * entity's card, which is now one generic adapter that names no type at all.
 */

/*
 * 0.2.18: the `UiView*` and `DesignSystem*` interfaces that stood here are GONE,
 * for the reason the nine `DatabaseTable*` ones above went.
 *
 * Both types are contributed by the built-in envelope
 * `c4s-plugin-frontend-mockups`, so the host holding their field-level shapes --
 * params, token groups, modes, their create/update/list inputs -- was the type
 * system's version of the privilege the envelope migration removes. The envelope
 * owns them, in its own `src/types.ts`, beside the `data.schema` that validates
 * the same fields at the router.
 *
 * `ResolvedTokenValue` and `UNRESOLVED_TOKEN` went with them: both are the
 * design-system alias resolver's vocabulary, and the resolver itself moved out
 * of `shared/design-system.ts` into the envelope.
 *
 * Nothing in the host imported any of them once the two entity trees left `src/`.
 */

// ─── Diagram (v0.1.64 — seventh entity type) ─────────────────────────────────

/** Diagram DSL language. `d2` is a reserved slot — only `mermaid` is implemented. */
export type DiagramFormat = 'mermaid' | 'd2';

export interface Diagram {
  slug: string;
  /** 0.2.22 — the reserved label. This type had none before; chips showed the slug. */
  title: string;
  format: DiagramFormat;
  /**
   * Literal DSL body (no trim). May be empty — a legal placeholder state.
   *
   * `contentBearing` since 0.2.22: it does NOT arrive with the entity from any
   * generic read. A reader gets `hasSource`/`sourceBytes` and fetches the body
   * from `GET /api/entities/diagram/:slug/content/source`. Kept on this
   * interface because the type still describes the whole entity — what changed
   * is which reads populate it.
   */
  source: string;
  hasSource?: boolean;
  sourceBytes?: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DiagramCreateInput {
  /** The reserved label, and the slug source. Required since 0.2.22. */
  title: string;
  /** DSL body (mermaid). Optional/empty = placeholder. */
  source?: string;
  format?: DiagramFormat;
  /** Optional explicit slug — also used by M17 restore to preserve identity. */
  slug?: string;
  tags?: string[];
}

export interface DiagramUpdateInput {
  title?: string;
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

/**
 * One entity's row in a delta: its identity, plus the delta itself.
 *
 * 0.2.31 — `changes` is the closed eight-operation dictionary rather than a
 * per-type bag of differently-named keys, and `raw` is gone with the deep-diff
 * mode that used to fill it. `op` spells the state `updated`, matching the
 * `EntityDiff` envelope this row carries; the PAGE-side `RawDeltaPageChange`
 * keeps `modified`, because that vocabulary belongs to M02's `FileDiff` and
 * pages have no logical schema to generate a delta from.
 */
export interface RawDeltaEntityChange {
  type: string;
  slug: string;
  op: 'created' | 'deleted' | 'updated' | 'noop';
  changes: DiffOp[];
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
  /** 0.2.22 — the reserved label. Defaults to the first 200 characters of `text`. */
  title: string;
  text: string;
  kind: AcKind;
  status: AcStatus;
  verifies: AcVerifyRef[];
  description: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /**
   * 0.2.23 — no `brokenVerifies` here.
   *
   * It was filled by the `ac` detail view, and a type contributes no read code
   * now: the record is its `data.schema` and nothing else. The AC panel derives
   * the marker from the candidate lists it already loads, and `classifyVerifies`
   * remains the server-side answer for `check_consistency`, which is a
   * project-wide report rather than a field on one record.
   */
}

export interface AcCreateInput {
  text: string;
  /** Omit to derive it from `text`. */
  title?: string;
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
  | 'user_input_response'
  /**
   * C21: a runtime warning from the adapter (degraded FS sandbox, ignored
   * execute params). Content is `{ "message": "…" }`, status always 'complete'
   * — a point event with no streaming phase. `chat_message.role` carries no SQL
   * CHECK, so this union IS the constraint; no migration accompanies it.
   */
  | 'warning';

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
   *  thread has a session; controls hydrate from this when session-locked.
   *  0.2.8 (C15): plus the turn-1 FS path scope, also resume-immutable. Optional — threads
   *  created before 0.2.8 have a snapshot without those two fields. */
  initialArchitectureConfig: {
    model: string;
    architectureConfig: Record<string, unknown>;
    allowedPaths?: string[];
    disallowedPaths?: string[];
  } | null;
  currentTodoItems: TodoItem[] | null;
  planMode: boolean;
  usage: UsageStats | null;
  contextSize: number | null;
  /** 0.1.127: N:1 attach — path relative to plansDir, no FK (dangling = graceful-degrade). */
  planPath: string | null;
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

/**
 * M17: an engine-backgrounded task (a `Bash run_in_background`, a `Monitor`
 * loop, a `workflow`) surfaced by agent-adapters 0.9.1's `background_task_*`
 * event family. **Never a subagent** — real spawned helper agents keep the
 * `subagent_*` family / {@link ChatSubagentTask}. `taskType` is passed through
 * by name ('shell' | 'monitor' | 'workflow' | future kinds).
 */
export interface ChatBackgroundTask {
  threadId: string;
  taskId: string;
  taskType: string;
  description: string;
  status: string;
  outputFile: string | null;
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

// --- M10: Plans (filesystem-backed as of 0.1.127 — see brief 0-1-126-to-0-1-127) ---

export type PlanAction =
  | 'replace'
  | 'append'
  | 'insert_after_section'
  | 'user_edit'
  | 'system_duplicate';
export type PlanChangedBy = 'agent' | 'user' | 'system';

/** Reserved frontmatter keys set at file-creation time, immutable from the claude4spec side. `title` and `applied` are mutable. */
export const PLAN_IMMUTABLE_FRONTMATTER_KEYS = ['type', 'created_at', 'created_by'] as const;

export interface PlanFrontmatter {
  type: 'plan';
  /** Required on create; `slug = slugify(title)` is derived once and then immutable — later title edits don't rename the file. */
  title: string;
  created_at: string;
  created_by: string;
  /**
   * 0.2.14 — "this plan has been applied to the specification". A DECLARATION,
   * not a computed fact: nothing verifies it against the spec's content or
   * version history. Written explicitly as `false` at create time; a plan
   * authored before 0.2.14 has no key at all and reads as `false` (no file
   * migration). Set to `true` only by the thread's agent through
   * `mark_plan_applied`; unset only by the user in the UI.
   */
  applied?: boolean;
  [key: string]: unknown;
}

export interface Plan {
  /** Path relative to plansDir, e.g. "add-dark-mode.md" (slug = slugify(title), immutable once created). */
  path: string;
  frontmatter: PlanFrontmatter;
  body: string;
  /** Full file content (frontmatter + body, byte-faithful) — mirrors Brief/Patch. */
  content: string;
  /** sha256 hex of `content` — used for optimistic concurrency. */
  hash: string;
  /** Derived from `file_version` (MAX(version) for this path under rootId='plan'), not a stored column. */
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Internal list-item shape for `PlanService.listPlans()` — like `BriefListItem`/
 * `PatchListItem` (pre-M36), this stays a service-internal type that
 * `routes/artifacts.ts`'s plan adapter maps to the generic `ArtifactListItem`
 * at the REST boundary (the bespoke `GET /api/plans` list route is gone —
 * superseded by `GET /api/artifacts/plan`).
 */
export interface PlanListItem {
  path: string;
  title: string | null;
  threadCount: number;
  lastThreadId: string | null;
  updatedAt: string;
  frontmatter: PlanFrontmatter;
  hash: string;
}

/**
 * 0.1.139 M36: one row of `GET /api/artifacts/:kind/:path/threads` — the
 * generic listing that replaced the per-kind `BriefThreadSummary` (brief/patch)
 * and `PlanThreadItem` (plan) projections.
 *
 * The set a caller gets back can be heterogeneous — a plan binds by `attach`,
 * so any thread kind may reference it, with or without plan mode — hence
 * `contextType`/`planMode` travel with every row rather than being implied by
 * the endpoint. `hasSystemPrompt` is a boolean precisely so the list never
 * drags `chat_thread.initial_system_prompt` (a blob) over the wire.
 */
export interface ArtifactThreadListItem {
  id: string;
  title: string | null;
  contextType: string;
  planMode: boolean;
  messageCount: number;
  hasSystemPrompt: boolean;
  updatedAt: string;
  /** Freshest thread of the first page — backs the "open last thread" shortcut. */
  isLast?: boolean;
}

/**
 * 0.1.138: `POST /api/plans/:slug/execute` and its DTOs (`ExecutePlanRequest`,
 * `ExecutePlanNewSessionResponse`, `ExecutePlanContinueResponse` — here
 * `PlanExecuteMode`/`PlanExecuteResult`) are GONE. Running a plan is now
 * `POST /api/plans/:slug/create-thread` + a client-side composer draft, so the
 * only wire shape left is the create-thread pair below.
 */
export interface CreateThreadFromPlanRequest {
  initialMessage?: string;
}

export interface CreateThreadFromPlanResponse {
  threadId: string;
}

export interface LastThreadForPlanResponse {
  threadId: string | null;
}

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

// --- M23: Patches ---

/** Why a coding agent filed the patch (frontmatter `patch_kind`). */
export type PatchKind = 'drift' | 'missing' | 'incorrect' | 'clarification';

/**
 * Reserved frontmatter keys — set by the terminal agent that authored the
 * patch, immutable from the claude4spec side. Only `applied` is mutable.
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
  /**
   * 0.2.14 — replaces the `status: awaiting | completed` enum with the same
   * boolean the plan carries: "is the deviation this patch describes already
   * applied to the specification". Absent reads as `false`.
   *
   * A legacy `status` key is an UNKNOWN field from here on: ignored on read
   * (even `status: completed` reads as `applied: false`) but left in the file
   * by gray-matter pass-through. Files on disk are not migrated.
   */
  applied?: boolean;
  [key: string]: unknown;
}

// --- M36: chat artifacts (generic REST family for brief/patch, /api/artifacts/:kind/*) ---

/** `GET /api/artifacts/:kind/:path` detail envelope (`{ data: ArtifactResponse }`). */
export interface ArtifactResponse {
  path: string;
  /** Parsed YAML frontmatter — kind-specific fields (source/status/patch_kind/...) live here. */
  frontmatter: Record<string, unknown>;
  body: string;
  /** Full file content (frontmatter + body, byte-faithful). */
  content: string;
  /** sha256 hex of `content` — used for optimistic concurrency. */
  hash: string;
}

/**
 * `GET /api/artifacts/:kind` list item. No `name`/`title`/`source`/`threadCount`
 * at the list level — kind-specific data lives in `frontmatter`; the client
 * derives a display title from `frontmatter.title` (brief) or the body's first
 * heading (patch) rather than the server bolting a synthesized field on.
 */
export interface ArtifactListItem {
  path: string;
  frontmatter: Record<string, unknown>;
  hash: string;
  updatedAt: string | null;
}

export interface ArtifactContentUpdateRequest {
  content: string;
  expectedHash: string;
}

/** Partial map of fields mutable per the kind's `frontmatterContract.mutable` (artifact-registry.ts). */
export interface ArtifactFrontmatterUpdateRequest {
  frontmatter: Record<string, unknown>;
}

export interface ArtifactThreadCreateRequest {
  name?: string;
}

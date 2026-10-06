import type { ProjectionScope, ProjectionState } from './projection-status.js';
export type PageNodeType = 'file' | 'folder';

/** M30: discriminator for a `type='file'` node. Missing ⇒ `'markdown'` (backward compatible). */
export type PageFileType = 'markdown' | 'html';

export interface PageNode {
  type: PageNodeType;
  name: string;
  path: string;
  children?: PageNode[];
  /** M30: only for `type='file'`. `.html` files are read-only previews, excluded from indexing/versioning. */
  fileType?: PageFileType;
}

export interface PageContent {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  /**
   * 0.2.15 — sha256 of the FULL file (frontmatter included) as read.
   *
   * Added because `expectedHash` became mandatory on `update_page`: a reader
   * that cannot obtain a hash has no legal way to write. The editor is the
   * caller this is for — it reads through this shape and had, until now, nothing
   * to arm the guard with, which is why the guard had been left optional.
   */
  hash: string;
}

/**
 * 2.1.6 — DTO `page-detail`: what `GET /api/pages/:rootId/*` answers — M02's own
 * read for the editor, not a rendering of the agent-facing `get_page` (which has
 * no REST channel). `content` is the WHOLE file byte for byte: frontmatter in the
 * text, anchor lines in place, XML tags unexpanded. `hash` is the sha256 of that
 * same file — the value `get_page` returns and the one the editor sends back as
 * `expectedHash`. No budget, no cut, no `truncated`/`hasMore`/`total` and no
 * section listing: the editor writes the file back whole.
 *
 * `frontmatter` and `body` stay alongside as the editor's split of the same
 * read, so it keeps writing through `PUT` without re-parsing the file itself.
 */
export interface PageDetail extends PageContent {
  rootId: string;
  content: string;
}

/**
 * What `PUT /api/pages/:rootId/<path>` answers with: what the caller could not
 * have predicted, and nothing it already had. Deliberately NOT `PageContent` —
 * see the echo-free rule in `server/services/page-write.ts`.
 *
 * No `content` (since 0.2.88): the write-back phase injects anchors, so the bytes on
 * disk are not the bytes sent, and a caller that needs them re-reads the page.
 * `changedAnchors` diffs disk-before against disk-after, so it cannot tell the
 * caller whether its own text still matches.
 */
export interface PageWriteAck {
  hash: string;
  version: number;
  changedAnchors: string[];
  /** 2.1.6 — anchors the write removed, when it removed any. */
  droppedAnchors?: string[];
}

/**
 * What `POST /api/pages/:rootId/move` answers with.
 *
 * `hash` is deliberately the SAME value the page had before the move: the
 * content is relocated by an atomic rename and never re-serialized, so nothing
 * about it changed. It is reported anyway because the caller needs it to arm its
 * next write at the new path, and re-reading a file it just moved to get a value
 * it already held would be a round trip for nothing.
 *
 * No `content`: a move is the one write that never reads what it writes.
 */
export interface PageMoveAck {
  rootId: string;
  /** The NEW path. */
  path: string;
  hash: string;
  version: number;
  /**
   * The citation rewrite that followed the move — reported, never thrown. The
   * move had already committed when it ran, so a failure here leaves the page
   * moved and some `@old/path.md` unrewritten; `error` says so instead of
   * turning a completed move into an error the caller would undo nothing for.
   */
  citationSync: { rewritten: string[]; error?: string };
}

export interface PageWriteInput {
  frontmatter?: Record<string, unknown>;
  body: string;
}

export interface PageSearchHit {
  path: string;
  line: number;
  snippet: string;
  matchesPath: boolean;
}

/** What a CRUD write did to its subject — the `action` of `entity:changed` / `tag:changed`. */
export type WsChangeAction = 'create' | 'update' | 'delete';

export type WsEvent =
  | { kind: 'file:changed'; event: 'add' | 'change' | 'unlink'; path: string; rootId: string; origin: 'server' | 'external' }
  /**
   * 0.2.106 (M49) — `action` says what the write did to `slug`. A write that only
   * touched a relation of the entity (a DTO link, a tag assignment) is `update`.
   */
  | { kind: 'entity:changed'; entityType: string; slug: string; action: WsChangeAction }
  /**
   * M40 0.2.76 — a `projection`-phase reaction failed twice on one path, so the
   * projection it owns is out of step with the file.
   *
   * The signal only STATES the fact. M40 does not know what the projection's
   * owner will do with it, and neither marking a projection stale nor enforcing
   * staleness (refusing to serve coordinates from a marked one) is closed in
   * this release; nor is the UI warning.
   */
  | { kind: 'projection:stale'; source: string; path: string; subscription: string }
  /**
   * 0.2.77 — a projection changed freshness. The fifth server→client event, and
   * the half `projection:stale` above deliberately left open.
   *
   * `projection:stale` is M40 REPORTING a reaction that failed twice; this is the
   * projection's OWNER stating what it decided that means. Only the owner can:
   * M40 does not know how many artifacts somebody else's projection divides into,
   * so it cannot say whether one bad page poisons the whole thing.
   *
   * Emitted in BOTH directions — the return to `fresh` is what takes the banner
   * down. The client invalidates the index-status cache key on it; nothing polls.
   */
  | {
      kind: 'index:status-changed';
      projection: string;
      state: ProjectionState;
      /** Present only with `state: 'stale'`: `'global'` or the marked artifacts. */
      scope?: ProjectionScope;
    }
  // M29: emitted by EntityIndexerService after a file-watch reindex (external
  // edit / git pull / self-write that slipped past suppress). `op: 'delete'`
  // when the entity file was unlinked. Boot indexAll() does NOT emit (runs
  // before listen()).
  | { kind: 'entity:indexed'; type: string; slug: string; op?: 'upsert' | 'delete' }
  /** `slug: ''` with `action: 'update'` — the watcher re-read tags wholesale. */
  | { kind: 'tag:changed'; slug: string; action: WsChangeAction }
  | { kind: 'section:indexed'; rootId: string; pagePath: string; anchors: string[] }
  | { kind: 'todos:changed'; rootId?: string; pagePath?: string }
  | { kind: 'pageLinks:changed'; rootId?: string; sourcePath?: string }
  | { kind: 'page:renamed'; from: string; to: string }
  /**
   * A plan changed. `planPath` is the routing key AND the only cache-invalidation
   * key — `threadId` never is, and must not be used as one.
   *
   * 0.2.15 — `threadId` is NULLABLE, and means the AUTHOR of this write, not the
   * owner of the plan. A plan has no owning thread: several can attach to one
   * (N:1), and the generic `PATCH /api/artifacts/plan/…/frontmatter` route has
   * no thread at all. `null` is the single representation of "no thread" — an
   * empty string is forbidden, and substituting the most-recently-attached
   * thread is forbidden too, because a consumer cannot tell a real author from
   * a guess and will attribute the write to someone who did not make it.
   *
   * Also emitted for a frontmatter-only write, which does NOT bump `version` —
   * so a consumer cannot infer a new version from having received the event.
   */
  | {
      kind: 'plan:updated';
      planPath: string;
      threadId: string | null;
      version: number;
      changedBy: 'agent' | 'user' | 'system';
    }
  | { kind: 'release:created'; releaseId: number; name: string }
  | { kind: 'release:updated'; releaseId: number; name: string }
  // M21 Briefs / M02 frontmatter indexer
  | { kind: 'pages:frontmatter-changed'; path: string; rootId: string }
  | { kind: 'briefs:changed'; path?: string; origin?: 'server' | 'external' }
  // M23 Patches
  | { kind: 'patches:changed'; path?: string }
  // 0.1.127 M36/M10: plans, filesystem-backed like briefs/patches.
  | { kind: 'plans:changed'; path?: string }
  | { kind: 'hello'; ts: number }
  // M31: sent to a room right before its sockets close (context invalidated/evicted/removed).
  | { kind: 'project:disposed' }
  // M33 phase 3: a plugin in the effective pool was installed/removed/edited on
  // disk and hot-reloaded (no process restart). The client invalidates the
  // plugin's React Query keys, refetches the frontend-manifest + import-map, and
  // remounts the plugin's frontend (editor extensions) WITHOUT resetting the
  // open document. `tier` distinguishes a base (workspace/npm) reload from a
  // project-local overlay reload.
  | { kind: 'plugin:reloaded'; name: string; version: string; tier: 'base' | 'overlay' };

/**
 * 0.1.96 multiroot: a file is keyed by `(rootId, path)`. 2.1.8: `rootId` is
 * always the id of a ROOT REGISTRY entry — a user root (`kind: pages`) or one
 * of the five system roots, whose id equals their kind. Briefs, patches and
 * plans are system roots, so their `file_version` rows carry these ids.
 */
export const BRIEF_ROOT_MARKER = 'briefs';
export const PATCH_ROOT_MARKER = 'patches';
/** 0.1.127 M10: plan artifact, filesystem-backed. */
export const PLAN_ROOT_MARKER = 'plans';

/**
 * A user root from `config.json` → `roots[]` (2.1.8: always of kind `pages`).
 * Exactly four fields: `dir` is a cwd-relative path (validated path-safe) and
 * `builtin` marks the single base root. Behaviour comes from the root's KIND
 * (`src/shared/root-kinds.ts`), never from per-root flags — those were removed.
 */
export interface Root {
  id: string;
  name: string;
  dir: string;
  builtin: boolean;
}

export interface TodoHit {
  /** 0.1.96: which root this page belongs to. */
  rootId: string;
  pagePath: string;
  line: number;
  col: number;
  comment: string;
  anchor: string;
}

export interface TodoCounts {
  byPath: Record<string, number>;
  total: number;
}

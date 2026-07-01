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

export type WsEvent =
  | { kind: 'page:changed'; event: 'add' | 'change' | 'unlink'; path: string; rootId: string; origin: 'server' | 'external' }
  | { kind: 'entity:changed'; entityType: string; slug: string }
  // M29: emitted by EntityIndexerService after a file-watch reindex (external
  // edit / git pull / self-write that slipped past suppress). `op: 'delete'`
  // when the entity file was unlinked. Boot indexAll() does NOT emit (runs
  // before listen()).
  | { kind: 'entity:indexed'; type: string; slug: string; op?: 'upsert' | 'delete' }
  | { kind: 'tag:changed'; slug: string }
  | { kind: 'section:indexed'; rootId: string; pagePath: string; anchors: string[] }
  | { kind: 'todos:changed'; rootId?: string; pagePath?: string }
  | { kind: 'pageLinks:changed'; rootId?: string; sourcePath?: string }
  | { kind: 'page:renamed'; from: string; to: string }
  | {
      kind: 'plan:updated';
      planId: number;
      threadId: string;
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
 * 0.1.96 multiroot: a page is keyed by `(rootId, path)`. `rootId` is a DYNAMIC
 * string — the built-in `'pages'` root, user-defined root slugs, plus the two
 * fixed markers below for briefs/patches (which are NOT roots but reuse the same
 * PagesService/PagesWatcher primitive and carry these literal rootId markers on
 * their `page_version` rows).
 */
export const BRIEF_ROOT_MARKER = 'brief';
export const PATCH_ROOT_MARKER = 'patch';

/** 0.1.96: how a root's page tree is surfaced in the sidebar. */
export type RootSidebar = 'accordion' | 'hidden';

/**
 * 0.1.96: a named page root. `dir` is a cwd-relative path (validated path-safe).
 * `builtin` is true only for the mandatory `'pages'` root. The remaining flags
 * are per-root behaviour gates — every per-directory behaviour is gated on one of
 * these properties, never on `if (rootId === 'pages')`.
 */
export interface Root {
  id: string;
  name: string;
  dir: string;
  builtin: boolean;
  /** Included in release bundles + git commits + release diffs. */
  releasable: boolean;
  /** Section-indexed (anchors, `/space/:rootId/$` navigation, SectionRef nodes). */
  sectionIndexed: boolean;
  /** Reference-validated (5 reference nodes, broken-ref decorations, propagation). */
  referenceValidated: boolean;
  /** Root ids whose pages are valid `@`-autocomplete / link targets from this root (in addition to self). */
  linkTargets: string[];
  /** How the root's tree appears in the sidebar. */
  sidebar: RootSidebar;
  /** Selectable as a brief scope target in the brief-scope modal. */
  briefTarget: boolean;
}

/** 0.1.96: per-root behaviour flags for a freshly-added user root (all gating off). */
export const DEFAULT_USER_ROOT_PROPS = {
  releasable: false,
  sectionIndexed: false,
  referenceValidated: false,
  linkTargets: [] as string[],
  sidebar: 'accordion' as RootSidebar,
  briefTarget: false,
} as const;

/** 0.1.96: per-root behaviour flags for the built-in `pages` root (full behaviour). */
export const DEFAULT_PAGES_ROOT_PROPS = {
  releasable: true,
  sectionIndexed: true,
  referenceValidated: true,
  linkTargets: [] as string[],
  sidebar: 'accordion' as RootSidebar,
  briefTarget: true,
} as const;

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

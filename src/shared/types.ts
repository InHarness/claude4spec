export type PageNodeType = 'file' | 'folder';

export interface PageNode {
  type: PageNodeType;
  name: string;
  path: string;
  children?: PageNode[];
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
  | { kind: 'page:changed'; event: 'add' | 'change' | 'unlink'; path: string; origin: 'server' | 'external' }
  | { kind: 'entity:changed'; entityType: string; slug: string }
  // M29: emitted by EntityIndexerService after a file-watch reindex (external
  // edit / git pull / self-write that slipped past suppress). `op: 'delete'`
  // when the entity file was unlinked. Boot indexAll() does NOT emit (runs
  // before listen()).
  | { kind: 'entity:indexed'; type: string; slug: string; op?: 'upsert' | 'delete' }
  | { kind: 'tag:changed'; slug: string }
  | { kind: 'section:indexed'; pagePath: string; anchors: string[] }
  | { kind: 'todos:changed'; pagePath?: string }
  | { kind: 'pageLinks:changed'; sourcePath?: string }
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
  | { kind: 'pages:frontmatter-changed'; path: string; rootDir: PagesRootDir }
  | { kind: 'briefs:changed'; path?: string; origin?: 'server' | 'external' }
  // M23 Patches
  | { kind: 'patches:changed'; path?: string }
  | { kind: 'hello'; ts: number };

/** M02 multidir: discriminator dla source-of-truth (pagesDir / briefsDir / patchesDir). */
export type PagesRootDir = 'pages' | 'briefs' | 'patches';

export interface TodoHit {
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

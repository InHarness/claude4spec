/**
 * Serverless collaborators for the references core (M19).
 *
 * The core knows nothing about a running server — no Express, ws, chokidar, or
 * PagesService. Every transport (REST, MCP, CLI) injects readonly collaborators
 * and projects the superset hit onto its own existing shape.
 */

/** A single markdown page: its project-relative path and frontmatter-stripped body. */
export interface ReferencePage {
  /**
   * Which root this page came from.
   *
   * M39 made it REQUIRED. It was optional with a `?? 'pages'` fallback in the
   * matcher, and two of the three sources never set it — so hits from a user
   * root were reported as belonging to the built-in one. A page position is
   * `(rootId, path)`; a source that cannot say which root it read from cannot
   * produce an addressable hit.
   */
  rootId: string;
  path: string;
  body: string;
}

/** Readonly page source — walks every page under the project's `pages/` dir. */
export interface PagesSource {
  listPages(): Promise<ReferencePage[]>;
}

/** Minimal entity host — only used to gate tag-driven matches. */
export interface ReferenceHost {
  entityExists(type: string, slug: string): boolean;
}

/** Tag slugs of a single entity (M18 read-side primitive). */
export type GetEntityTagSlugs = (type: string, slug: string) => string[];

export interface FindReferencesDeps {
  pages: PagesSource;
  /** Required only when `includeTagMatches` is true. */
  host?: ReferenceHost;
  /** Required only when `includeTagMatches` is true. */
  getEntityTagSlugs?: GetEntityTagSlugs;
}

export interface FindReferencesOptions {
  /** Also report dynamic refs whose tagged_list/tagged_list_mixed tags intersect the entity. */
  includeTagMatches?: boolean;
}

/**
 * Superset hit. Static rows carry `raw`; tag-driven rows carry `via`. Each
 * transport projects this onto its own contract (REST keeps `raw`, drops `via`;
 * MCP/CLI keep `via`, drop `raw`).
 */
export interface SupersetHit {
  /** 0.1.96: which root the referencing page lives in (default 'pages'). */
  rootId: string;
  pagePath: string;
  tagType: string;
  line: number;
  raw?: string;
  via?: string[];
}

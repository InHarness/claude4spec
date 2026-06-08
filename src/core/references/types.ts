/**
 * Serverless collaborators for the references core (M19).
 *
 * The core knows nothing about a running server — no Express, ws, chokidar, or
 * PagesService. Every transport (REST, MCP, CLI) injects readonly collaborators
 * and projects the superset hit onto its own existing shape.
 */

/** A single markdown page: its project-relative path and frontmatter-stripped body. */
export interface ReferencePage {
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
  pagePath: string;
  tagType: string;
  line: number;
  raw?: string;
  via?: string[];
}

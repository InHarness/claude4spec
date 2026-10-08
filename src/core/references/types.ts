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

// ── Embed expansion (2.1.9, M19 `t7mekve3`) ─────────────────────────────────

/** Chips and lists read with the empty projection, a card with the full record. */
export type ExpansionProjection = 'empty' | 'full';

/** An entity record as the context's reader returns it; `title` is the label. */
export interface ExpansionEntity {
  slug: string;
  title?: string;
  href?: string;
  [field: string]: unknown;
}

/** One row of a listing by tags. */
export interface ExpansionListedEntity {
  type: string;
  slug: string;
  title: string;
}

/** A page link the context's page index recognised in the text, by offset. */
export interface ExpansionPageLink {
  syntax: 'link' | 'at' | 'backticks';
  raw: string;
  start: number;
  end: number;
  targetPath: string;
  anchor?: string;
}

/** The page a text comes from — lets a relative page link resolve. Optional. */
export interface ExpansionSource {
  rootId: string;
  path: string;
}

/**
 * The read-only collaborators of ONE project context — the only way the
 * expansion reaches project state. Built by the caller for the project it
 * names; the function holds no other handle, so it cannot read another
 * project.
 */
export interface ExpansionContext {
  /** Entity reader by slugs with a projection — one call per `(type, projection)`. */
  readEntities(
    type: string,
    slugs: string[],
    projection: ExpansionProjection,
  ): Promise<Array<{ slug: string; entity: ExpansionEntity | null }>> | Array<{ slug: string; entity: ExpansionEntity | null }>;
  /** Listing by tags (the tags module's); `type` absent = every active type. */
  listByTags(input: {
    type?: string;
    tags: string[];
    filter: 'and' | 'or';
  }): Promise<ExpansionListedEntity[]> | ExpansionListedEntity[];
  /** Section index: the heading text of the section with this anchor. */
  sectionHeading(anchor: string): Promise<string | null> | string | null;
  /** Page index: the page links in `text`. */
  findPageLinks(text: string): ExpansionPageLink[];
  /** Page index: the title of the page a link points at, or null. */
  pageTitle(link: ExpansionPageLink, source?: ExpansionSource): Promise<string | null> | string | null;
}

export type ExpansionFormat = 'inline' | 'json';

export interface ExpandEmbedsOptions {
  format: ExpansionFormat;
  /** Where the text comes from, for relative page links. */
  source?: ExpansionSource;
}

/** One tag (or page link) of the text: its position, the expanded data, or the error. */
export interface ResolvedEmbed {
  /** The tag name, or `page_link`. */
  kind: string;
  raw: string;
  /** Offsets into the ORIGINAL text, `end` exclusive. */
  start: number;
  end: number;
  /** 1-based line in the original text. */
  line: number;
  data?: unknown;
  /** Present when the target did not resolve — the tag then stays in the text unchanged. */
  error?: string;
}

/**
 * `inline` — the expanded markdown; `json` — the ORIGINAL text plus
 * `resolved[]`. Both carry `resolved` so a caller of `inline` can still see
 * what stayed broken.
 */
export type ExpandEmbedsResult =
  | { format: 'inline'; text: string; resolved: ResolvedEmbed[] }
  | { format: 'json'; text: string; resolved: ResolvedEmbed[] };

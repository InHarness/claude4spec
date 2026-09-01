import type Database from 'better-sqlite3';
import type { SectionIndexEntry } from '../../shared/entities.js';
import { parseXmlTagsExcludingCode, serializeXmlTag } from '../../shared/xml-tags.js';
import type { PagesService } from './pages.js';
import type { SelfWriteMarker } from '../fs/sources.js';

/**
 * 0.2.46 — how much of `section_index.body` a generic listing may emit.
 *
 * `GET /api/sections` returns `contentSnippet`, a preview of the materialized
 * column cut to this fixed width. It is a preview, never the content: the
 * emission discipline did not loosen when the index started storing bodies.
 * Matches the width the page-search snippet has always used (see PagesService).
 */
export const SECTION_CONTENT_SNIPPET_CHARS = 160;

/**
 * How much of the column a generic read pulls out of SQLite to build that preview.
 *
 * Not the same number as the width above, and not decoration. A section's body
 * runs to the next heading of ITS OWN LEVEL OR SHALLOWER, so an H1 section's
 * body is the whole page — reading `body` in full to hand back 160 characters
 * would read the corpus once per heading level on every listing. So the cut
 * happens in SQL and the widening covers what `sectionSnippet` then strips:
 * the blank line after the heading, and the `<!-- anchor: … -->` lines above
 * every nested heading in the window (~28 characters each).
 *
 * The degradation is bounded and deliberate: a section whose first 640
 * characters are almost entirely machinery — a dozen-plus consecutive empty
 * subsections — yields a preview shorter than the width above. A preview is
 * allowed to be cheap; a caller who needs the content asks `get_sections`.
 */
const SECTION_BODY_READ_CHARS = SECTION_CONTENT_SNIPPET_CHARS * 4;

/**
 * The columns a generic read selects. `body` is deliberately not among them —
 * it enters only as the `substr` above, under the alias `body_head`, so that no
 * later `SELECT *` can quietly put the whole column back on the read path.
 */
const SECTION_COLUMNS = `id, anchor, rootId, page_path, heading_slug, heading_level,
       heading_text, content_hash, substr(body, 1, ${SECTION_BODY_READ_CHARS}) AS body_head,
       line_start, line_end, paragraph_count, created_at, updated_at`;

/**
 * An anchor comment is machinery — it is in the body, but it is not content.
 *
 * The trailing newline goes with it. Dropping only the text would leave the
 * blank line behind, so a preview of a parent section would read
 * `…below it.\n\n\n## Alpha` — the anchor's ghost, still spending width.
 */
const ANCHOR_COMMENT_RE = /^[ \t]*<!--\s*anchor:\s*[A-Za-z0-9_-]+\s*-->[ \t]*\r?\n?/gm;

/**
 * The preview itself: strip the anchor comments, then trim, then cut.
 *
 * Trimming is not cosmetic. Every body starts with the blank line that follows
 * its heading, and a parent section's body continues into its children — so a
 * raw prefix of the column would open with a newline and a nested anchor
 * comment, spending most of the width on markup before the first word.
 */
export function sectionSnippet(body: string): string {
  return body.replace(ANCHOR_COMMENT_RE, '').trim().slice(0, SECTION_CONTENT_SNIPPET_CHARS);
}

interface SectionRow {
  id: number;
  anchor: string;
  rootId: string;
  page_path: string;
  heading_slug: string;
  heading_level: number;
  heading_text: string;
  content_hash: string;
  /** The `substr` window of `body`, never the column — see SECTION_BODY_READ_CHARS. */
  body_head: string;
  line_start: number;
  line_end: number;
  paragraph_count: number;
  created_at: string;
  updated_at: string;
}

export interface SectionsListQuery {
  pagePath?: string;
  search?: string;
  limit?: number;
}

/** 0.1.96: one section-indexed root — its PagesService plus the watcher whose
 * captures we suppress when rewriting section_ref anchors. */
export interface SectionsRootWriteDeps {
  pages: PagesService;
  watcher: SelfWriteMarker;
}

/**
 * 0.1.96: write-side deps are now a map over the SECTION-INDEXED roots
 * (rootId → {pages, watcher}). Anchor-rename propagation rewrites `<section_ref/>`
 * occurrences across EVERY section-indexed root, not just the built-in 'pages'.
 */
export type SectionsServiceWriteDeps = Map<string, SectionsRootWriteDeps>;

export class SectionsService {
  private writeDeps: SectionsServiceWriteDeps | null = null;

  constructor(private db: Database.Database) {}

  /** Wire write-side dependencies after construction (avoids circular deps with PagesService bootstrap). */
  setWriteDeps(deps: SectionsServiceWriteDeps): void {
    this.writeDeps = deps;
  }

  getByAnchor(anchor: string): SectionIndexEntry | null {
    const row = this.db
      .prepare(`SELECT ${SECTION_COLUMNS} FROM section_index WHERE anchor = ?`)
      .get(anchor) as SectionRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  has(anchor: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS x FROM section_index WHERE anchor = ? LIMIT 1')
      .get(anchor) as { x: number } | undefined;
    return Boolean(row);
  }

  listByPage(pagePath: string): SectionIndexEntry[] {
    const rows = this.db
      .prepare(`SELECT ${SECTION_COLUMNS} FROM section_index WHERE page_path = ? ORDER BY line_start`)
      .all(pagePath) as SectionRow[];
    return rows.map((r) => this.hydrate(r));
  }

  list(query: SectionsListQuery = {}): SectionIndexEntry[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.pagePath) {
      where.push('page_path = ?');
      params.push(query.pagePath);
    }
    if (query.search) {
      /**
       * 0.2.59 — `heading_text` alone. The second half of this filter was
       * `heading_path LIKE ?`, and that column is gone: it encoded the ancestor
       * chain slash-joined into one TEXT field, which `get_page_outline`'s tree
       * replaced. Nothing regressed for the editor either way — the `/section`
       * autocomplete loads this listing whole and fuzzy-matches CLIENT-side over
       * the heading and the page path, so this parameter has no caller today.
       */
      where.push('heading_text LIKE ?');
      params.push(`%${query.search}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(query.limit ?? 500, 1), 2000);
    const rows = this.db
      .prepare(
        `SELECT ${SECTION_COLUMNS} FROM section_index ${whereSql} ORDER BY page_path, line_start LIMIT ?`,
      )
      .all(...params, limit) as SectionRow[];
    return rows.map((r) => this.hydrate(r));
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM section_index').get() as { c: number };
    return row.c;
  }

  /**
   * Rewrite all `<section_ref anchor="oldAnchor"/>` occurrences to newAnchor across
   * EVERY section-indexed root (0.1.96). Atomic per-file with rollback on error.
   * Emits file:changed via watcher suppress on each write. `changed` entries are
   * `${rootId}:${relPath}` so a path present in two roots stays disambiguated.
   * Page links `@path.md#anchor` (M14) live elsewhere — handled by M14's link rewriter.
   */
  async propagateAnchorChange(
    oldAnchor: string,
    newAnchor: string,
  ): Promise<{ changed: string[] }> {
    if (oldAnchor === newAnchor) return { changed: [] };
    if (!this.writeDeps) {
      throw new Error('SectionsService.propagateAnchorChange requires setWriteDeps to be called');
    }
    const changed: string[] = [];
    // key `${rootId}:${relPath}` → { root deps, original body } for rollback.
    const backups = new Map<string, { root: SectionsRootWriteDeps; rel: string; body: string }>();

    for (const [rootId, root] of this.writeDeps) {
      const files = await root.pages.listMarkdownFiles();
      for (const rel of files) {
        const page = await root.pages.read(rel);
        const rewritten = rewriteSectionRefAnchor(page.body, oldAnchor, newAnchor);
        if (rewritten !== page.body) {
          backups.set(`${rootId}:${rel}`, { root, rel, body: page.body });
        }
      }
    }

    try {
      for (const [key, { root, rel }] of backups) {
        const current = await root.pages.read(rel);
        const newBody = rewriteSectionRefAnchor(current.body, oldAnchor, newAnchor);
        if (newBody !== current.body) {
          root.watcher.suppress(rel);
          await root.pages.write(rel, { frontmatter: current.frontmatter, body: newBody });
          changed.push(key);
        }
      }
    } catch (err) {
      for (const [key, { root, rel, body }] of backups) {
        if (!changed.includes(key)) continue;
        const current = await root.pages.read(rel);
        root.watcher.suppress(rel);
        await root.pages.write(rel, { frontmatter: current.frontmatter, body });
      }
      throw err;
    }

    return { changed };
  }

  private hydrate(row: SectionRow): SectionIndexEntry {
    return {
      id: row.id,
      anchor: row.anchor,
      rootId: row.rootId,
      pagePath: row.page_path,
      headingSlug: row.heading_slug,
      headingLevel: row.heading_level,
      headingText: row.heading_text,
      contentHash: row.content_hash,
      // A bounded preview, never the column itself — this projection is what
      // every generic read of the index goes through.
      contentSnippet: sectionSnippet(row.body_head),
      lineStart: row.line_start,
      lineEnd: row.line_end,
      paragraphCount: row.paragraph_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function rewriteSectionRefAnchor(body: string, oldAnchor: string, newAnchor: string): string {
  const tags = parseXmlTagsExcludingCode(body);
  if (tags.length === 0) return body;
  let out = '';
  let cursor = 0;
  for (const tag of tags) {
    out += body.slice(cursor, tag.start);
    if (tag.kind === 'section_ref' && tag.attrs.anchor === oldAnchor) {
      out += serializeXmlTag('section_ref', { ...tag.attrs, anchor: newAnchor });
    } else {
      out += body.slice(tag.start, tag.end);
    }
    cursor = tag.end;
  }
  out += body.slice(cursor);
  return out;
}

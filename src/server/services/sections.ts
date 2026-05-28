import type Database from 'better-sqlite3';
import type { SectionIndexEntry } from '../../shared/entities.js';
import { parseXmlTagsExcludingCode, serializeXmlTag } from '../../shared/xml-tags.js';
import type { PagesService } from './pages.js';
import type { PagesWatcher } from '../fs/watcher.js';

interface SectionRow {
  id: number;
  anchor: string;
  page_path: string;
  heading_path: string;
  heading_slug: string;
  heading_level: number;
  heading_text: string;
  content_hash: string;
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

export interface SectionsServiceWriteDeps {
  pages: PagesService;
  watcher: PagesWatcher;
}

export class SectionsService {
  private writeDeps: SectionsServiceWriteDeps | null = null;

  constructor(private db: Database.Database) {}

  /** Wire write-side dependencies after construction (avoids circular deps with PagesService bootstrap). */
  setWriteDeps(deps: SectionsServiceWriteDeps): void {
    this.writeDeps = deps;
  }

  getByAnchor(anchor: string): SectionIndexEntry | null {
    const row = this.db
      .prepare('SELECT * FROM section_index WHERE anchor = ?')
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
      .prepare('SELECT * FROM section_index WHERE page_path = ? ORDER BY line_start')
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
      where.push('(heading_text LIKE ? OR heading_path LIKE ?)');
      const like = `%${query.search}%`;
      params.push(like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(query.limit ?? 500, 1), 2000);
    const rows = this.db
      .prepare(`SELECT * FROM section_index ${whereSql} ORDER BY page_path, line_start LIMIT ?`)
      .all(...params, limit) as SectionRow[];
    return rows.map((r) => this.hydrate(r));
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM section_index').get() as { c: number };
    return row.c;
  }

  /**
   * Rewrite all `<section_ref anchor="oldAnchor"/>` occurrences across pagesDir to newAnchor.
   * Atomic per-file with rollback on error. Emits page:changed via watcher suppress on each write.
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
    const { pages, watcher } = this.writeDeps;
    const changed: string[] = [];
    const backups = new Map<string, string>();

    const files = await pages.listMarkdownFiles();
    for (const rel of files) {
      const page = await pages.read(rel);
      const rewritten = rewriteSectionRefAnchor(page.body, oldAnchor, newAnchor);
      if (rewritten !== page.body) {
        backups.set(rel, page.body);
      }
    }

    try {
      for (const [rel, originalBody] of backups) {
        const current = await pages.read(rel);
        const newBody = rewriteSectionRefAnchor(current.body, oldAnchor, newAnchor);
        if (newBody !== current.body) {
          watcher.suppress(rel);
          await pages.write(rel, { frontmatter: current.frontmatter, body: newBody });
          changed.push(rel);
        }
        void originalBody;
      }
    } catch (err) {
      for (const [rel, originalBody] of backups) {
        if (!changed.includes(rel)) continue;
        const current = await pages.read(rel);
        watcher.suppress(rel);
        await pages.write(rel, { frontmatter: current.frontmatter, body: originalBody });
      }
      throw err;
    }

    return { changed };
  }

  private hydrate(row: SectionRow): SectionIndexEntry {
    return {
      id: row.id,
      anchor: row.anchor,
      pagePath: row.page_path,
      headingPath: row.heading_path,
      headingSlug: row.heading_slug,
      headingLevel: row.heading_level,
      headingText: row.heading_text,
      contentHash: row.content_hash,
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

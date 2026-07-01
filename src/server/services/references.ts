import type Database from 'better-sqlite3';
import type { EntityType, ReferenceHit } from '../../shared/entities.js';
import {
  parseXmlTagsExcludingCode,
  serializeXmlTag,
  type XmlTag,
} from '../../shared/xml-tags.js';
import type { PagesService } from './pages.js';
import type { PagesWatcher } from '../fs/watcher.js';
import type { EntityStore } from './entity-store.js';
import { isRawEntityType, type RawEntityType } from '../domain/raw-entity-reader.js';
import { findReferences as findReferencesCore } from '../../core/references/index.js';
import type { PagesSource, ReferencePage } from '../../core/references/index.js';

/**
 * Adapt a server-side PagesService into the serverless `PagesSource` the
 * references core (M19) consumes. The core never imports PagesService directly.
 */
export function pagesServiceSource(pages: PagesService): PagesSource {
  return {
    async listPages(): Promise<ReferencePage[]> {
      const files = await pages.listMarkdownFiles();
      const out: ReferencePage[] = [];
      for (const rel of files) {
        const page = await pages.read(rel);
        out.push({ path: rel, body: page.body });
      }
      return out;
    },
  };
}

export class ReferencesService {
  /**
   * 0.1.96 multiroot: the service is bound to the REFERENCE-VALIDATED page roots
   * (config.roots filtered by `referenceValidated`), keyed by `rootId`. Every
   * walk/propagate iterates that subset keyed `(rootId, path)`; writes go through
   * the matching root's `PagesService` + `PagesWatcher` (suppress before write).
   * Entity-file propagation (setEntityDeps) is root-agnostic and unchanged.
   */
  constructor(
    private roots: Map<string, PagesService>,
    private watchers: Map<string, PagesWatcher>,
  ) {}

  private watcherFor(rootId: string): PagesWatcher | undefined {
    return this.watchers.get(rootId);
  }

  /**
   * M29: deps for propagating a slug rename into the committed entity files
   * (not just page markdown). Wired post-construction (store is built later).
   */
  private db: Database.Database | null = null;
  private store: EntityStore | null = null;
  setEntityDeps(db: Database.Database, store: EntityStore): void {
    this.db = db;
    this.store = store;
  }

  /**
   * M29 (m29ren001): after an entity rename, rewrite the slug inside OTHER
   * committed entity files whose snapshots embed it:
   *   - dto rename → endpoint files' `linked_dtos[]` (endpoint_dto already
   *     cascaded in the index; re-persist the affected endpoint files).
   *   - any rename → ac files' `verifies[]` (soft JSON ref, no FK) — repoint in
   *     the index then re-persist the affected ac files.
   * Files-only; page XML refs are handled by the caller above.
   */
  private propagateInEntityFiles(type: EntityType, oldSlug: string, newSlug: string): void {
    const db = this.db;
    const store = this.store;
    if (!db || !store) return;

    // dto rename → endpoints (linked_dtos)
    if (type === 'dto') {
      const eps = db
        .prepare(`SELECT DISTINCT endpoint_slug AS slug FROM endpoint_dto WHERE dto_slug = ?`)
        .all(newSlug) as Array<{ slug: string }>;
      for (const e of eps) {
        try {
          store.persist('endpoint', e.slug);
        } catch {
          /* skip */
        }
      }
    }

    // design-system rename → ui-view files' scalar `designSystemSlug` (v0.1.59).
    // Pattern mirrors database-table → fk.table: repoint the column in the index,
    // then re-persist each affected ui-view file (atomic-write + suppress + reindex).
    if (type === 'design-system') {
      const views = db
        .prepare(`SELECT slug FROM ui_view WHERE design_system_slug = ?`)
        .all(oldSlug) as Array<{ slug: string }>;
      if (views.length) {
        const upd = db.prepare(`UPDATE ui_view SET design_system_slug = ? WHERE slug = ?`);
        for (const v of views) {
          upd.run(newSlug, v.slug);
          try {
            store.persist('ui-view', v.slug);
          } catch {
            /* skip */
          }
        }
      }
    }

    // any rename → ac verifies[] ({type, slug} soft refs)
    if (isRawEntityType(type)) {
      const acs = db
        .prepare(`SELECT slug, verifies FROM ac WHERE verifies LIKE ?`)
        .all(`%${oldSlug}%`) as Array<{ slug: string; verifies: string }>;
      const upd = db.prepare(`UPDATE ac SET verifies = ? WHERE slug = ?`);
      for (const ac of acs) {
        let parsed: Array<{ type?: string; slug?: string }>;
        try {
          parsed = JSON.parse(ac.verifies);
          if (!Array.isArray(parsed)) continue;
        } catch {
          continue;
        }
        let changed = false;
        for (const ref of parsed) {
          if (ref && ref.type === type && ref.slug === oldSlug) {
            ref.slug = newSlug;
            changed = true;
          }
        }
        if (changed) {
          upd.run(JSON.stringify(parsed), ac.slug);
          try {
            store.persist('ac', ac.slug);
          } catch {
            /* skip */
          }
        }
      }
    }
  }

  /**
   * Aggregate the reference-validated roots into a single serverless `PagesSource`
   * (M19) so the core walks every root's markdown once.
   */
  private aggregateSource(): PagesSource {
    const roots = this.roots;
    return {
      async listPages(): Promise<ReferencePage[]> {
        const out: ReferencePage[] = [];
        for (const pages of roots.values()) {
          const files = await pages.listMarkdownFiles();
          for (const rel of files) {
            const page = await pages.read(rel);
            out.push({ path: rel, body: page.body });
          }
        }
        return out;
      },
    };
  }

  async findReferences(type: EntityType, slug: string): Promise<ReferenceHit[]> {
    // Delegate to the serverless core (M19); static-only (no includeTagMatches),
    // so every superset hit carries `raw`. Project back onto ReferenceHit.
    const hits = await findReferencesCore({ pages: this.aggregateSource() }, type, slug);
    return hits.map((h) => ({
      pagePath: h.pagePath,
      tagType: h.tagType,
      line: h.line,
      raw: h.raw ?? '',
    }));
  }

  async findPagesReferencingSlugs(type: EntityType, slugs: Set<string>): Promise<Set<string>> {
    const out = new Set<string>();
    await this.walkPages(async (_rootId, relPath, body) => {
      for (const tag of parseXmlTagsExcludingCode(body)) {
        if (tag.attrs.type && tag.attrs.type !== type && tag.kind !== 'tagged_list_mixed') continue;
        const hasSlug = entitySlugsInTag(tag).some((s) => slugs.has(s));
        if (hasSlug) out.add(relPath);
      }
    });
    return out;
  }

  async propagateSlugChange(
    type: EntityType,
    oldSlug: string,
    newSlug: string
  ): Promise<{ changed: string[] }> {
    if (oldSlug === newSlug) return { changed: [] };
    const changed: string[] = [];
    // Keyed by (rootId, relPath): a bare relPath is ambiguous across roots.
    const backups = new Map<string, { rootId: string; relPath: string; body: string }>();
    const changedKeys = new Set<string>();
    const key = (rootId: string, relPath: string) => `${rootId} ${relPath}`;

    const mutate = (tag: XmlTag): Record<string, string> | null => {
      if (tag.kind === 'diagram') {
        if (type !== 'diagram' || tag.attrs.slug !== oldSlug) return null;
        return { ...tag.attrs, slug: newSlug };
      }
      if (tag.attrs.type !== type) return null;
      if (tag.kind === 'inline_mention' || tag.kind === 'single_element') {
        if (tag.attrs.slug !== oldSlug) return null;
        return { ...tag.attrs, slug: newSlug };
      }
      if (tag.kind === 'element_list') {
        const slugs = splitCsv(tag.attrs.slugs);
        if (!slugs.includes(oldSlug)) return null;
        return { ...tag.attrs, slugs: slugs.map((s) => (s === oldSlug ? newSlug : s)).join(',') };
      }
      return null;
    };

    await this.walkPages(async (rootId, relPath, body) => {
      const rewritten = rewriteTagsInBody(body, mutate);
      if (rewritten !== body) {
        backups.set(key(rootId, relPath), { rootId, relPath, body });
      }
    });

    try {
      for (const { rootId, relPath } of backups.values()) {
        const pages = this.roots.get(rootId);
        if (!pages) continue;
        const current = await pages.read(relPath);
        const newBody = rewriteTagsInBody(current.body, mutate);
        if (newBody !== current.body) {
          this.watcherFor(rootId)?.suppress(relPath);
          await pages.write(relPath, { frontmatter: current.frontmatter, body: newBody });
          changed.push(relPath);
          changedKeys.add(key(rootId, relPath));
        }
      }
    } catch (err) {
      for (const { rootId, relPath, body: originalBody } of backups.values()) {
        if (!changedKeys.has(key(rootId, relPath))) continue;
        const pages = this.roots.get(rootId);
        if (!pages) continue;
        const current = await pages.read(relPath);
        this.watcherFor(rootId)?.suppress(relPath);
        await pages.write(relPath, { frontmatter: current.frontmatter, body: originalBody });
      }
      throw err;
    }

    // M29: also rewrite the slug inside other committed entity files.
    this.propagateInEntityFiles(type, oldSlug, newSlug);

    return { changed };
  }

  async propagateTagSlugChange(
    oldTagSlug: string,
    newTagSlug: string
  ): Promise<{ changed: string[] }> {
    if (oldTagSlug === newTagSlug) return { changed: [] };
    const changed: string[] = [];

    await this.walkPages(async (rootId, relPath, body) => {
      const newBody = rewriteTagsInBody(body, (tag) => {
        if (tag.kind !== 'tagged_list' && tag.kind !== 'tagged_list_mixed') return null;
        const tags = splitCsv(tag.attrs.tags);
        if (!tags.includes(oldTagSlug)) return null;
        return { ...tag.attrs, tags: tags.map((t) => (t === oldTagSlug ? newTagSlug : t)).join(',') };
      });
      if (newBody !== body) {
        const pages = this.roots.get(rootId);
        if (!pages) return;
        const current = await pages.read(relPath);
        this.watcherFor(rootId)?.suppress(relPath);
        await pages.write(relPath, { frontmatter: current.frontmatter, body: newBody });
        changed.push(relPath);
      }
    });

    return { changed };
  }

  private async walkPages(
    visit: (rootId: string, relPath: string, body: string) => Promise<void>
  ): Promise<void> {
    for (const [rootId, pages] of this.roots) {
      const files = await pages.listMarkdownFiles();
      for (const rel of files) {
        const page = await pages.read(rel);
        await visit(rootId, rel, page.body);
      }
    }
  }
}

function entitySlugsInTag(tag: XmlTag): string[] {
  if (tag.kind === 'inline_mention' || tag.kind === 'single_element') {
    return tag.attrs.slug ? [tag.attrs.slug] : [];
  }
  if (tag.kind === 'element_list') return splitCsv(tag.attrs.slugs);
  return [];
}

function splitCsv(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function rewriteTagsInBody(
  body: string,
  mutate: (tag: XmlTag) => Record<string, string> | null
): string {
  const tags = parseXmlTagsExcludingCode(body);
  if (tags.length === 0) return body;
  let out = '';
  let cursor = 0;
  for (const tag of tags) {
    const nextAttrs = mutate(tag);
    out += body.slice(cursor, tag.start);
    if (nextAttrs) {
      out += serializeXmlTag(tag.kind, nextAttrs);
    } else {
      out += body.slice(tag.start, tag.end);
    }
    cursor = tag.end;
  }
  out += body.slice(cursor);
  return out;
}



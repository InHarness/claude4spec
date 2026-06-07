import type Database from 'better-sqlite3';
import type {
  BrokenReference,
  ChangedBy,
  UiView,
  UiViewCreateInput,
  UiViewDeleteResult,
  UiViewListQuery,
  UiViewParam,
  UiViewParamLocation,
  UiViewUpdateInput,
} from '../../../shared/entities.js';
import { uiViewSlug } from '../../services/slug.js';
import { DomainError } from '../../services/tags.js';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';
import type { EntityStore } from '../../services/entity-store.js';

interface UiViewRow {
  slug: string;
  name: string;
  url: string | null;
  description: string | null;
  params: string;
  created_at: string;
  updated_at: string;
}

/**
 * M29: write options. `capture: false` suppresses the entity_version capture —
 * used by the index-reconstruction path (boot rebuild / incremental reindex),
 * where the file is the commit point and capture happens once in the write-path
 * orchestrator, not inside the service mutation.
 */
export interface MutateOpts {
  capture?: boolean;
  /** M29: false ⇒ do not (re)write the entity JSON file (index-rebuild path). */
  writeFile?: boolean;
}

const VALID_LOCATIONS: ReadonlyArray<UiViewParamLocation> = ['path', 'query', 'hash'];

export class UiViewService {
  constructor(
    private db: Database.Database,
    private tags: TagsService,
    private versions: VersionService,
    private store: EntityStore
  ) {}

  create(
    input: UiViewCreateInput,
    actor: ChangedBy,
    opts: MutateOpts = {}
  ): { uiView: UiView; warnings: string[] } {
    if (!input.name) throw new DomainError('VALIDATION', 'name is required');
    const slug = input.slug?.trim() || uiViewSlug(input.name);
    if (!slug) throw new DomainError('VALIDATION', 'slug resolves to empty');

    const params = input.params ?? [];
    const url = normaliseUrl(input.url);

    const tx = this.db.transaction(() => {
      const conflict = this.db.prepare(`SELECT 1 FROM ui_view WHERE slug = ?`).get(slug);
      if (conflict)
        throw new DomainError('SLUG_CONFLICT', `ui view slug '${slug}' already exists`);

      this.db
        .prepare(
          `INSERT INTO ui_view (slug, name, url, description, params)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(slug, input.name, url, input.description ?? null, JSON.stringify(params));
      if (input.tags?.length) this.tags.assignTags('ui-view', slug, input.tags);
      const created = this.getBySlugInternal(slug);
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('ui-view', slug, 'create', actor, 'Created', '1.0.0');
      }
      const warnings = computeWarnings(url, params);
      return { uiView: created, warnings };
    });
    const created = tx();
    // M29: the entity file is the source of truth — persist after the index
    // commit (skipped on the index-rebuild path, opts.writeFile === false).
    if (opts.writeFile !== false) this.store.persist('ui-view', created.uiView.slug);
    return created;
  }

  list(query: UiViewListQuery = {}): UiView[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (query.search) {
      where.push(`(name LIKE ? OR description LIKE ? OR slug LIKE ? OR url LIKE ?)`);
      const like = `%${query.search}%`;
      params.push(like, like, like, like);
    }

    const tagSlugs = query.tags?.filter(Boolean) ?? [];
    if (tagSlugs.length) {
      const placeholders = tagSlugs.map(() => '?').join(',');
      if (query.tagFilter === 'or') {
        where.push(`
          slug IN (
            SELECT et.entity_slug FROM entity_tag et
             WHERE et.entity_type = 'ui-view' AND et.tag_slug IN (${placeholders})
          )
        `);
        params.push(...tagSlugs);
      } else {
        where.push(`
          slug IN (
            SELECT et.entity_slug
              FROM entity_tag et
             WHERE et.entity_type = 'ui-view' AND et.tag_slug IN (${placeholders})
          GROUP BY et.entity_slug
            HAVING COUNT(DISTINCT et.tag_slug) = ?
          )
        `);
        params.push(...tagSlugs, tagSlugs.length);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);

    const rows = this.db
      .prepare(
        `SELECT * FROM ui_view ${whereSql}
         ORDER BY name
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as UiViewRow[];

    return rows.map((r) => this.hydrate(r));
  }

  getBySlug(slug: string): UiView | null {
    const row = this.db.prepare(`SELECT * FROM ui_view WHERE slug = ?`).get(slug) as
      | UiViewRow
      | undefined;
    return row ? this.hydrate(row) : null;
  }

  update(
    slug: string,
    input: UiViewUpdateInput,
    actor: ChangedBy,
    opts: MutateOpts = {}
  ): { uiView: UiView; previousSlug: string; warnings: string[] } {
    const tx = this.db.transaction(() => {
      const current = this.db.prepare(`SELECT * FROM ui_view WHERE slug = ?`).get(slug) as
        | UiViewRow
        | undefined;
      if (!current) throw new DomainError('NOT_FOUND', `ui view '${slug}' not found`);

      const nextName = input.name ?? current.name;
      const autoSlug = uiViewSlug(nextName);
      const nextSlug = input.newSlug?.trim() || autoSlug;

      if (nextSlug !== slug) {
        const conflict = this.db.prepare(`SELECT 1 FROM ui_view WHERE slug = ?`).get(nextSlug);
        if (conflict)
          throw new DomainError('SLUG_CONFLICT', `ui view slug '${nextSlug}' already exists`);
      }

      const nextParams =
        input.params !== undefined ? JSON.stringify(input.params) : current.params;
      const nextUrl =
        input.url !== undefined ? normaliseUrl(input.url) : current.url;

      this.db
        .prepare(
          `UPDATE ui_view
             SET slug = ?, name = ?, url = ?, description = ?, params = ?,
                 updated_at = datetime('now')
           WHERE slug = ?`
        )
        .run(
          nextSlug,
          nextName,
          nextUrl,
          input.description !== undefined ? input.description : current.description,
          nextParams,
          slug
        );

      // M29: a rename moves entity_tag rows to the new slug (entity_tag is
      // polymorphic, no FK on entity_slug — must follow the rename explicitly).
      if (nextSlug !== slug) {
        this.db
          .prepare(`UPDATE entity_tag SET entity_slug = ? WHERE entity_type = 'ui-view' AND entity_slug = ?`)
          .run(nextSlug, slug);
      }

      if (input.tags) this.tags.assignTags('ui-view', nextSlug, input.tags);

      const updated = this.getBySlugInternal(nextSlug);
      const summary = nextSlug !== slug ? `Renamed from '${slug}' to '${nextSlug}'` : 'Updated';
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('ui-view', nextSlug, 'update', actor, summary, '1.0.0');
      }
      const warnings = computeWarnings(updated.url, updated.params);
      return { uiView: updated, previousSlug: slug, warnings };
    });
    const result = tx();
    if (opts.writeFile !== false) {
      const nextSlug = result.uiView.slug;
      if (nextSlug !== slug) this.store.remove('ui-view', slug); // rename: drop the old file
      this.store.persist('ui-view', nextSlug);
    }
    return result;
  }

  /**
   * Idempotent UPSERT for M17 restore. CREATE if slug missing, UPDATE
   * otherwise; preserves slug.
   */
  upsert(
    slug: string,
    input: UiViewCreateInput,
    actor: ChangedBy,
    opts: MutateOpts = {}
  ): { uiView: UiView; op: 'created' | 'updated'; warnings: string[] } {
    const existing = this.getBySlug(slug);
    if (!existing) {
      const result = this.create({ ...input, slug }, actor, opts);
      return { uiView: result.uiView, op: 'created', warnings: result.warnings };
    }
    const result = this.update(slug, {
      name: input.name,
      url: input.url,
      description: input.description,
      params: input.params,
      tags: input.tags,
    }, actor, opts);
    return { uiView: result.uiView, op: 'updated', warnings: result.warnings };
  }

  remove(
    slug: string,
    actor: ChangedBy,
    brokenReferences: BrokenReference[] = [],
    opts: MutateOpts = {}
  ): UiViewDeleteResult {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM ui_view WHERE slug = ?`).get(slug) as
        | UiViewRow
        | undefined;
      if (!row) throw new DomainError('NOT_FOUND', `ui view '${slug}' not found`);

      // M17: capture snapshot BEFORE delete.
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('ui-view', slug, 'delete', actor, 'Deleted', '1.0.0');
      }
      this.db
        .prepare(`DELETE FROM entity_tag WHERE entity_type = 'ui-view' AND entity_slug = ?`)
        .run(slug);
      this.db.prepare(`DELETE FROM ui_view WHERE slug = ?`).run(slug);
      return { deleted: true as const, brokenReferences };
    });
    const result = tx();
    if (opts.writeFile !== false) this.store.remove('ui-view', slug);
    return result;
  }

  private getBySlugInternal(slug: string): UiView {
    const row = this.db.prepare(`SELECT * FROM ui_view WHERE slug = ?`).get(slug) as
      | UiViewRow
      | undefined;
    if (!row) throw new Error(`ui_view '${slug}' disappeared mid-tx`);
    return this.hydrate(row);
  }

  private hydrate(row: UiViewRow): UiView {
    return {
      slug: row.slug,
      name: row.name,
      url: row.url,
      description: row.description,
      params: parseParams(row.params),
      tags: this.tags.getEntityTagSlugs('ui-view', row.slug),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function normaliseUrl(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parseParams(raw: string): UiViewParam[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p === 'object' && typeof p.name === 'string')
      .map((p) => {
        const inValue = String(p.in ?? '');
        const location = (VALID_LOCATIONS as readonly string[]).includes(inValue)
          ? (inValue as UiViewParamLocation)
          : ('query' satisfies UiViewParamLocation);
        const out: UiViewParam = {
          name: String(p.name),
          in: location,
        };
        if (typeof p.type === 'string') out.type = p.type;
        if (typeof p.required === 'boolean') out.required = p.required;
        if (typeof p.default === 'string') out.default = p.default;
        if (typeof p.description === 'string') out.description = p.description;
        return out;
      });
  } catch {
    return [];
  }
}

const PATH_PARAM_RE = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;

export function computeWarnings(
  url: string | null,
  params: UiViewParam[]
): string[] {
  const warnings: string[] = [];

  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    if (!p.name) {
      warnings.push(`params[${i}]: missing 'name'`);
    }
    if (!(VALID_LOCATIONS as readonly string[]).includes(p.in as string)) {
      warnings.push(`params[${i}] '${p.name ?? '?'}': invalid 'in' value '${p.in}' (expected path|query|hash)`);
    }
  }

  const seen = new Set<string>();
  for (const p of params) {
    const key = `${p.in}::${p.name}`;
    if (seen.has(key)) {
      warnings.push(`Duplicate param (name='${p.name}', in='${p.in}')`);
    }
    seen.add(key);
  }

  const urlPathParams = new Set<string>();
  if (url) {
    const matches = url.matchAll(PATH_PARAM_RE);
    for (const m of matches) urlPathParams.add(m[1]!);
  }

  const declaredPathParams = new Set(
    params.filter((p) => p.in === 'path' && p.name).map((p) => p.name)
  );

  for (const name of urlPathParams) {
    if (!declaredPathParams.has(name)) {
      warnings.push(`path param ":${name}" in URL not declared in params[]`);
    }
  }
  for (const name of declaredPathParams) {
    if (url && !urlPathParams.has(name)) {
      warnings.push(`path param '${name}' declared but not present in URL`);
    }
  }

  if (url === null && declaredPathParams.size > 0) {
    warnings.push(`path params declared but URL is null (modal/drawer should not have path params)`);
  }

  return warnings;
}

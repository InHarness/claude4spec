import type Database from 'better-sqlite3';
import type {
  BrokenReference,
  ChangedBy,
  Endpoint,
  EndpointCreateInput,
  EndpointDeleteResult,
  EndpointDtoLink,
  EndpointDtoRelation,
  EndpointListQuery,
  EndpointUpdateInput,
  HttpMethod,
} from '../../../shared/entities.js';
import { endpointSlug } from '../../services/slug.js';
import { DomainError } from '../../services/tags.js';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';
import type { EntityStore } from '../../services/entity-store.js';

const ALLOWED_RELATIONS: ReadonlySet<EndpointDtoRelation> = new Set<EndpointDtoRelation>([
  'request',
  'response',
  'error',
]);

interface EndpointRow {
  slug: string;
  method: string;
  path: string;
  summary: string;
  description: string | null;
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

const ALLOWED_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

export class EndpointService {
  constructor(
    private db: Database.Database,
    private tags: TagsService,
    private versions: VersionService,
    private store: EntityStore
  ) {}

  create(input: EndpointCreateInput, actor: ChangedBy, opts: MutateOpts = {}): Endpoint {
    const method = this.requireMethod(input.method);
    if (!input.path) throw new DomainError('VALIDATION', 'path is required');
    const slug = endpointSlug(method, input.path);
    if (!slug) throw new DomainError('VALIDATION', 'slug resolves to empty');

    const tx = this.db.transaction(() => {
      const conflict = this.db.prepare(`SELECT 1 FROM endpoint WHERE slug = ?`).get(slug);
      if (conflict) throw new DomainError('SLUG_CONFLICT', `endpoint slug '${slug}' already exists`);

      this.db
        .prepare(
          `INSERT INTO endpoint (slug, method, path, summary, description)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          slug,
          method,
          input.path,
          input.summary ?? '',
          input.description ?? null
        );
      if (input.tags?.length) this.tags.assignTags('endpoint', slug, input.tags);
      const created = this.getBySlugInternal(slug);
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('endpoint', slug, 'create', actor, 'Created', '1.0.0');
      }
      return created;
    });
    const created = tx();
    // M29: the entity file is the source of truth — persist after the index
    // commit (skipped on the index-rebuild path, opts.writeFile === false).
    if (opts.writeFile !== false) this.store.persist('endpoint', created.slug);
    return created;
  }

  list(query: EndpointListQuery = {}): Endpoint[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (query.search) {
      where.push(`(path LIKE ? OR summary LIKE ? OR slug LIKE ?)`);
      const like = `%${query.search}%`;
      params.push(like, like, like);
    }

    let tagFilter: string | null = null;
    const tagSlugs = query.tags?.filter(Boolean) ?? [];
    if (tagSlugs.length) {
      const placeholders = tagSlugs.map(() => '?').join(',');
      if (query.tagFilter === 'and') {
        tagFilter = `
          slug IN (
            SELECT et.entity_slug
              FROM entity_tag et
             WHERE et.entity_type = 'endpoint' AND et.tag_slug IN (${placeholders})
          GROUP BY et.entity_slug
            HAVING COUNT(DISTINCT et.tag_slug) = ?
          )
        `;
        params.push(...tagSlugs, tagSlugs.length);
      } else {
        tagFilter = `
          slug IN (
            SELECT et.entity_slug FROM entity_tag et
             WHERE et.entity_type = 'endpoint' AND et.tag_slug IN (${placeholders})
          )
        `;
        params.push(...tagSlugs);
      }
    }
    if (tagFilter) where.push(tagFilter);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);

    const rows = this.db
      .prepare(
        `SELECT * FROM endpoint
         ${whereSql}
         ORDER BY path, method
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as EndpointRow[];

    return rows.map((r) => this.hydrate(r));
  }

  getBySlug(slug: string): Endpoint | null {
    const row = this.db.prepare(`SELECT * FROM endpoint WHERE slug = ?`).get(slug) as
      | EndpointRow
      | undefined;
    return row ? this.hydrate(row) : null;
  }

  update(slug: string, input: EndpointUpdateInput, actor: ChangedBy, opts: MutateOpts = {}): Endpoint {
    const tx = this.db.transaction(() => {
      const current = this.db.prepare(`SELECT * FROM endpoint WHERE slug = ?`).get(slug) as
        | EndpointRow
        | undefined;
      if (!current) throw new DomainError('NOT_FOUND', `endpoint '${slug}' not found`);

      const method = input.method ? this.requireMethod(input.method) : (current.method as HttpMethod);
      const path = input.path ?? current.path;
      const autoSlug = endpointSlug(method, path);
      const nextSlug = input.newSlug ?? autoSlug;

      if (nextSlug !== slug) {
        const conflict = this.db.prepare(`SELECT 1 FROM endpoint WHERE slug = ?`).get(nextSlug);
        if (conflict) throw new DomainError('SLUG_CONFLICT', `endpoint slug '${nextSlug}' already exists`);
      }

      const nextRow: EndpointRow = {
        ...current,
        slug: nextSlug,
        method,
        path,
        summary: input.summary ?? current.summary,
        description: input.description !== undefined ? input.description : current.description,
      };

      this.db
        .prepare(
          `UPDATE endpoint
             SET slug = ?, method = ?, path = ?, summary = ?, description = ?,
                 updated_at = datetime('now')
           WHERE slug = ?`
        )
        .run(
          nextRow.slug,
          nextRow.method,
          nextRow.path,
          nextRow.summary,
          nextRow.description,
          slug
        );

      // M29: a rename moves entity_tag rows to the new slug (entity_tag is
      // polymorphic, no FK on entity_slug — must follow the rename explicitly).
      // endpoint_dto.endpoint_slug follows automatically via FK ON UPDATE CASCADE.
      if (nextSlug !== slug) {
        this.db
          .prepare(`UPDATE entity_tag SET entity_slug = ? WHERE entity_type = 'endpoint' AND entity_slug = ?`)
          .run(nextSlug, slug);
      }

      if (input.tags) this.tags.assignTags('endpoint', nextSlug, input.tags);

      const updated = this.getBySlugInternal(nextSlug);
      const summary = nextSlug !== slug ? `Renamed from '${slug}' to '${nextSlug}'` : 'Updated';
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('endpoint', nextSlug, 'update', actor, summary, '1.0.0');
      }
      return updated;
    });
    const result = tx();
    if (opts.writeFile !== false) {
      if (result.slug !== slug) this.store.remove('endpoint', slug); // rename: drop the old file
      this.store.persist('endpoint', result.slug);
    }
    return result;
  }

  /**
   * Idempotent UPSERT used by M17 restore. Routes to create or update based on
   * existence of `slug`; preserves slug across update (no rename).
   */
  upsert(slug: string, input: EndpointCreateInput, actor: ChangedBy, opts: MutateOpts = {}): { entity: Endpoint; op: 'created' | 'updated' } {
    const existing = this.getBySlug(slug);
    if (!existing) {
      const entity = this.create(input, actor, opts);
      return { entity, op: 'created' };
    }
    const entity = this.update(slug, {
      method: input.method,
      path: input.path,
      summary: input.summary,
      description: input.description,
      tags: input.tags,
    }, actor, opts);
    return { entity, op: 'updated' };
  }

  remove(slug: string, actor: ChangedBy, opts: MutateOpts = {}): EndpointDeleteResult {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM endpoint WHERE slug = ?`).get(slug) as
        | EndpointRow
        | undefined;
      if (!row) throw new DomainError('NOT_FOUND', `endpoint '${slug}' not found`);

      // M17: capture snapshot BEFORE delete so the tombstone preserves
      // last-known data (used by restore-from-tombstone in M17 Phase 6).
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('endpoint', slug, 'delete', actor, 'Deleted', '1.0.0');
      }
      this.db
        .prepare(`DELETE FROM entity_tag WHERE entity_type = 'endpoint' AND entity_slug = ?`)
        .run(slug);
      this.db.prepare(`DELETE FROM endpoint WHERE slug = ?`).run(slug);

      const brokenReferences: BrokenReference[] = [];
      return { deleted: true as const, brokenReferences };
    });
    const result = tx();
    if (opts.writeFile !== false) this.store.remove('endpoint', slug);
    return result;
  }

  private getBySlugInternal(slug: string): Endpoint {
    const row = this.db.prepare(`SELECT * FROM endpoint WHERE slug = ?`).get(slug) as
      | EndpointRow
      | undefined;
    if (!row) throw new Error(`endpoint '${slug}' disappeared mid-tx`);
    return this.hydrate(row);
  }

  private hydrate(row: EndpointRow): Endpoint {
    return {
      slug: row.slug,
      method: row.method as HttpMethod,
      path: row.path,
      summary: row.summary,
      description: row.description,
      tags: this.tags.getEntityTagSlugs('endpoint', row.slug),
      dtos: this.getLinkedDtos(row.slug),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getLinkedDtos(endpointSlug: string): EndpointDtoLink[] {
    const rows = this.db
      .prepare(
        `SELECT d.slug AS dto_slug, d.name AS dto_name, ed.relation AS relation, ed.status_code AS status_code
           FROM endpoint_dto ed
           JOIN dto d ON d.slug = ed.dto_slug
          WHERE ed.endpoint_slug = ?
          ORDER BY ed.relation, ed.status_code, d.name`
      )
      .all(endpointSlug) as Array<{
        dto_slug: string;
        dto_name: string;
        relation: string;
        status_code: number | null;
      }>;
    return rows.map((r) => ({
      dtoSlug: r.dto_slug,
      dtoName: r.dto_name,
      relation: r.relation as EndpointDtoRelation,
      statusCode: r.status_code,
    }));
  }

  linkDto(
    endpointSlug: string,
    dtoSlug: string,
    relation: EndpointDtoRelation,
    statusCode: number | null = null,
    opts: MutateOpts = {}
  ): Endpoint {
    if (!ALLOWED_RELATIONS.has(relation)) {
      throw new DomainError('VALIDATION', `invalid relation '${relation}'`);
    }
    if (relation === 'request' && statusCode !== null) {
      throw new DomainError('VALIDATION', `request relation must not carry a status code`);
    }
    const ep = this.db.prepare(`SELECT slug FROM endpoint WHERE slug = ?`).get(endpointSlug) as
      | { slug: string }
      | undefined;
    if (!ep) throw new DomainError('NOT_FOUND', `endpoint '${endpointSlug}' not found`);
    const dto = this.db.prepare(`SELECT slug FROM dto WHERE slug = ?`).get(dtoSlug) as
      | { slug: string }
      | undefined;
    if (!dto) throw new DomainError('NOT_FOUND', `dto '${dtoSlug}' not found`);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO endpoint_dto (endpoint_slug, dto_slug, relation, status_code)
           VALUES (?, ?, ?, ?)`
      )
      .run(endpointSlug, dtoSlug, relation, statusCode);
    const result = this.getBySlugInternal(endpointSlug);
    // M29: linking changes the endpoint snapshot (linked_dtos) — re-persist its
    // file. Skipped on the index-rebuild path (writeFile === false).
    if (opts.writeFile !== false) this.store.persist('endpoint', endpointSlug);
    return result;
  }

  unlinkDto(
    endpointSlug: string,
    dtoSlug: string,
    relation: EndpointDtoRelation,
    statusCode: number | null = null,
    opts: MutateOpts = {}
  ): Endpoint {
    const ep = this.db.prepare(`SELECT slug FROM endpoint WHERE slug = ?`).get(endpointSlug) as
      | { slug: string }
      | undefined;
    if (!ep) throw new DomainError('NOT_FOUND', `endpoint '${endpointSlug}' not found`);
    if (statusCode === null) {
      this.db
        .prepare(
          `DELETE FROM endpoint_dto
             WHERE endpoint_slug = ? AND dto_slug = ? AND relation = ? AND status_code IS NULL`
        )
        .run(endpointSlug, dtoSlug, relation);
    } else {
      this.db
        .prepare(
          `DELETE FROM endpoint_dto
             WHERE endpoint_slug = ? AND dto_slug = ? AND relation = ? AND status_code = ?`
        )
        .run(endpointSlug, dtoSlug, relation, statusCode);
    }
    const result = this.getBySlugInternal(endpointSlug);
    if (opts.writeFile !== false) this.store.persist('endpoint', endpointSlug);
    return result;
  }

  private requireMethod(m: string): HttpMethod {
    const upper = m.toUpperCase() as HttpMethod;
    if (!ALLOWED_METHODS.has(upper)) {
      throw new DomainError('VALIDATION', `unsupported method '${m}'`);
    }
    return upper;
  }
}

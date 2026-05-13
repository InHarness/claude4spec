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

const ALLOWED_RELATIONS: ReadonlySet<EndpointDtoRelation> = new Set<EndpointDtoRelation>([
  'request',
  'response',
  'error',
]);

interface EndpointRow {
  id: number;
  slug: string;
  method: string;
  path: string;
  summary: string;
  description: string | null;
  created_at: string;
  updated_at: string;
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
    private versions: VersionService
  ) {}

  create(input: EndpointCreateInput, actor: ChangedBy): Endpoint {
    const method = this.requireMethod(input.method);
    if (!input.path) throw new DomainError('VALIDATION', 'path is required');
    const slug = endpointSlug(method, input.path);
    if (!slug) throw new DomainError('VALIDATION', 'slug resolves to empty');

    const tx = this.db.transaction(() => {
      const conflict = this.db.prepare(`SELECT 1 FROM endpoint WHERE slug = ?`).get(slug);
      if (conflict) throw new DomainError('SLUG_CONFLICT', `endpoint slug '${slug}' already exists`);

      const info = this.db
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
      const id = Number(info.lastInsertRowid);
      if (input.tags?.length) this.tags.assignTags('endpoint', id, input.tags);
      const created = this.getByIdInternal(id);
      this.versions.captureEntitySnapshot('endpoint', id, 'create', actor, 'Created', '1.0.0');
      return created;
    });
    return tx();
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
          id IN (
            SELECT et.entity_id
              FROM entity_tag et
              JOIN tag t ON t.id = et.tag_id
             WHERE et.entity_type = 'endpoint' AND t.slug IN (${placeholders})
          GROUP BY et.entity_id
            HAVING COUNT(DISTINCT t.slug) = ?
          )
        `;
        params.push(...tagSlugs, tagSlugs.length);
      } else {
        tagFilter = `
          id IN (
            SELECT et.entity_id FROM entity_tag et
              JOIN tag t ON t.id = et.tag_id
             WHERE et.entity_type = 'endpoint' AND t.slug IN (${placeholders})
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

  getIdBySlug(slug: string): number | null {
    const row = this.db.prepare(`SELECT id FROM endpoint WHERE slug = ?`).get(slug) as
      | { id: number }
      | undefined;
    return row?.id ?? null;
  }

  update(slug: string, input: EndpointUpdateInput, actor: ChangedBy): Endpoint {
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
           WHERE id = ?`
        )
        .run(
          nextRow.slug,
          nextRow.method,
          nextRow.path,
          nextRow.summary,
          nextRow.description,
          current.id
        );

      if (input.tags) this.tags.assignTags('endpoint', current.id, input.tags);

      const updated = this.getByIdInternal(current.id);
      const summary = nextSlug !== slug ? `Renamed from '${slug}' to '${nextSlug}'` : 'Updated';
      this.versions.captureEntitySnapshot('endpoint', current.id, 'update', actor, summary, '1.0.0');
      return updated;
    });
    return tx();
  }

  /**
   * Idempotent UPSERT used by M17 restore. Routes to create or update based on
   * existence of `slug`; preserves slug across update (no rename).
   */
  upsert(slug: string, input: EndpointCreateInput, actor: ChangedBy): { entity: Endpoint; op: 'created' | 'updated' } {
    const existing = this.getBySlug(slug);
    if (!existing) {
      const entity = this.create(input, actor);
      return { entity, op: 'created' };
    }
    const entity = this.update(slug, {
      method: input.method,
      path: input.path,
      summary: input.summary,
      description: input.description,
      tags: input.tags,
    }, actor);
    return { entity, op: 'updated' };
  }

  remove(slug: string, actor: ChangedBy): EndpointDeleteResult {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM endpoint WHERE slug = ?`).get(slug) as
        | EndpointRow
        | undefined;
      if (!row) throw new DomainError('NOT_FOUND', `endpoint '${slug}' not found`);

      // M17: capture snapshot BEFORE delete so the tombstone preserves
      // last-known data (used by restore-from-tombstone in M17 Phase 6).
      this.versions.captureEntitySnapshot('endpoint', row.id, 'delete', actor, 'Deleted', '1.0.0');
      this.db
        .prepare(`DELETE FROM entity_tag WHERE entity_type = 'endpoint' AND entity_id = ?`)
        .run(row.id);
      this.db.prepare(`DELETE FROM endpoint WHERE id = ?`).run(row.id);

      const brokenReferences: BrokenReference[] = [];
      return { deleted: true as const, brokenReferences };
    });
    return tx();
  }

  private getByIdInternal(id: number): Endpoint {
    const row = this.db.prepare(`SELECT * FROM endpoint WHERE id = ?`).get(id) as
      | EndpointRow
      | undefined;
    if (!row) throw new Error(`endpoint id ${id} disappeared mid-tx`);
    return this.hydrate(row);
  }

  private hydrate(row: EndpointRow): Endpoint {
    return {
      slug: row.slug,
      method: row.method as HttpMethod,
      path: row.path,
      summary: row.summary,
      description: row.description,
      tags: this.tags.getEntityTagSlugs('endpoint', row.id),
      dtos: this.getLinkedDtos(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getLinkedDtos(endpointId: number): EndpointDtoLink[] {
    const rows = this.db
      .prepare(
        `SELECT d.slug AS dto_slug, d.name AS dto_name, ed.relation AS relation, ed.status_code AS status_code
           FROM endpoint_dto ed
           JOIN dto d ON d.id = ed.dto_id
          WHERE ed.endpoint_id = ?
          ORDER BY ed.relation, ed.status_code, d.name`
      )
      .all(endpointId) as Array<{
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
    statusCode: number | null = null
  ): Endpoint {
    if (!ALLOWED_RELATIONS.has(relation)) {
      throw new DomainError('VALIDATION', `invalid relation '${relation}'`);
    }
    if (relation === 'request' && statusCode !== null) {
      throw new DomainError('VALIDATION', `request relation must not carry a status code`);
    }
    const ep = this.db.prepare(`SELECT id FROM endpoint WHERE slug = ?`).get(endpointSlug) as
      | { id: number }
      | undefined;
    if (!ep) throw new DomainError('NOT_FOUND', `endpoint '${endpointSlug}' not found`);
    const dto = this.db.prepare(`SELECT id FROM dto WHERE slug = ?`).get(dtoSlug) as
      | { id: number }
      | undefined;
    if (!dto) throw new DomainError('NOT_FOUND', `dto '${dtoSlug}' not found`);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO endpoint_dto (endpoint_id, dto_id, relation, status_code)
           VALUES (?, ?, ?, ?)`
      )
      .run(ep.id, dto.id, relation, statusCode);
    return this.getByIdInternal(ep.id);
  }

  unlinkDto(
    endpointSlug: string,
    dtoSlug: string,
    relation: EndpointDtoRelation,
    statusCode: number | null = null
  ): Endpoint {
    const ep = this.db.prepare(`SELECT id FROM endpoint WHERE slug = ?`).get(endpointSlug) as
      | { id: number }
      | undefined;
    if (!ep) throw new DomainError('NOT_FOUND', `endpoint '${endpointSlug}' not found`);
    const dto = this.db.prepare(`SELECT id FROM dto WHERE slug = ?`).get(dtoSlug) as
      | { id: number }
      | undefined;
    if (!dto) throw new DomainError('NOT_FOUND', `dto '${dtoSlug}' not found`);
    if (statusCode === null) {
      this.db
        .prepare(
          `DELETE FROM endpoint_dto
             WHERE endpoint_id = ? AND dto_id = ? AND relation = ? AND status_code IS NULL`
        )
        .run(ep.id, dto.id, relation);
    } else {
      this.db
        .prepare(
          `DELETE FROM endpoint_dto
             WHERE endpoint_id = ? AND dto_id = ? AND relation = ? AND status_code = ?`
        )
        .run(ep.id, dto.id, relation, statusCode);
    }
    return this.getByIdInternal(ep.id);
  }

  private requireMethod(m: string): HttpMethod {
    const upper = m.toUpperCase() as HttpMethod;
    if (!ALLOWED_METHODS.has(upper)) {
      throw new DomainError('VALIDATION', `unsupported method '${m}'`);
    }
    return upper;
  }
}

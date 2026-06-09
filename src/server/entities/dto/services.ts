import type Database from 'better-sqlite3';
import type {
  BrokenReference,
  ChangedBy,
  Dto,
  DtoCreateInput,
  DtoDeleteResult,
  DtoEndpointLink,
  DtoExample,
  DtoField,
  DtoListQuery,
  DtoUpdateInput,
  EndpointDtoRelation,
  HttpMethod,
} from '../../../shared/entities.js';
import { dtoSlug } from '../../services/slug.js';
import { DomainError } from '../../services/tags.js';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';
import type { EntityStore } from '../../services/entity-store.js';

interface DtoRow {
  slug: string;
  name: string;
  description: string | null;
  fields: string;
  examples: string;
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

export class DtoService {
  constructor(
    private db: Database.Database,
    private tags: TagsService,
    private versions: VersionService,
    private store: EntityStore
  ) {}

  create(input: DtoCreateInput, actor: ChangedBy, opts: MutateOpts = {}): Dto {
    if (!input.name) throw new DomainError('VALIDATION', 'name is required');
    const slug = input.slug?.trim() || dtoSlug(input.name);
    if (!slug) throw new DomainError('VALIDATION', 'slug resolves to empty');
    const examples = input.examples ?? [];
    validateExampleNames(examples);

    const tx = this.db.transaction(() => {
      const conflict = this.db.prepare(`SELECT 1 FROM dto WHERE slug = ?`).get(slug);
      if (conflict) throw new DomainError('SLUG_CONFLICT', `dto slug '${slug}' already exists`);

      this.db
        .prepare(
          `INSERT INTO dto (slug, name, description, fields, examples)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          slug,
          input.name,
          input.description ?? null,
          JSON.stringify(input.fields ?? []),
          JSON.stringify(examples)
        );
      if (input.tags?.length) this.tags.assignTags('dto', slug, input.tags);
      const created = this.getBySlugInternal(slug);
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('dto', slug, 'create', actor, 'Created', '1.1.0');
      }
      return created;
    });
    const created = tx();
    // M29: the entity file is the source of truth — persist after the index
    // commit (skipped on the index-rebuild path, opts.writeFile === false).
    if (opts.writeFile !== false) this.store.persist('dto', created.slug);
    return created;
  }

  list(query: DtoListQuery = {}): Dto[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (query.search) {
      where.push(`(name LIKE ? OR description LIKE ? OR slug LIKE ?)`);
      const like = `%${query.search}%`;
      params.push(like, like, like);
    }

    const tagSlugs = query.tags?.filter(Boolean) ?? [];
    if (tagSlugs.length) {
      const placeholders = tagSlugs.map(() => '?').join(',');
      if (query.tagFilter === 'and') {
        where.push(`
          slug IN (
            SELECT et.entity_slug
              FROM entity_tag et
             WHERE et.entity_type = 'dto' AND et.tag_slug IN (${placeholders})
          GROUP BY et.entity_slug
            HAVING COUNT(DISTINCT et.tag_slug) = ?
          )
        `);
        params.push(...tagSlugs, tagSlugs.length);
      } else {
        where.push(`
          slug IN (
            SELECT et.entity_slug FROM entity_tag et
             WHERE et.entity_type = 'dto' AND et.tag_slug IN (${placeholders})
          )
        `);
        params.push(...tagSlugs);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);

    const rows = this.db
      .prepare(
        `SELECT * FROM dto ${whereSql}
         ORDER BY name
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as DtoRow[];

    return rows.map((r) => this.hydrate(r));
  }

  getBySlug(slug: string): Dto | null {
    const row = this.db.prepare(`SELECT * FROM dto WHERE slug = ?`).get(slug) as DtoRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  update(
    slug: string,
    input: DtoUpdateInput,
    actor: ChangedBy,
    opts: MutateOpts = {}
  ): { dto: Dto; previousSlug: string } {
    const tx = this.db.transaction(() => {
      const current = this.db.prepare(`SELECT * FROM dto WHERE slug = ?`).get(slug) as
        | DtoRow
        | undefined;
      if (!current) throw new DomainError('NOT_FOUND', `dto '${slug}' not found`);

      const nextName = input.name ?? current.name;
      // Slug jest stabilny: zmiana name nie przegenerowuje sluga.
      // Rename wyłącznie przez jawny newSlug.
      const nextSlug = input.newSlug?.trim() || current.slug;

      if (nextSlug !== slug) {
        const conflict = this.db.prepare(`SELECT 1 FROM dto WHERE slug = ?`).get(nextSlug);
        if (conflict) throw new DomainError('SLUG_CONFLICT', `dto slug '${nextSlug}' already exists`);
      }

      const nextFields = input.fields !== undefined ? JSON.stringify(input.fields) : current.fields;

      let nextExamples = current.examples;
      if (input.examples !== undefined) {
        validateExampleNames(input.examples);
        nextExamples = JSON.stringify(input.examples);
      }

      this.db
        .prepare(
          `UPDATE dto
             SET slug = ?, name = ?, description = ?, fields = ?, examples = ?,
                 updated_at = datetime('now')
           WHERE slug = ?`
        )
        .run(
          nextSlug,
          nextName,
          input.description !== undefined ? input.description : current.description,
          nextFields,
          nextExamples,
          slug
        );

      // M29: a rename moves entity_tag rows to the new slug (entity_tag is
      // polymorphic, no FK on entity_slug — must follow the rename explicitly).
      if (nextSlug !== slug) {
        this.db
          .prepare(`UPDATE entity_tag SET entity_slug = ? WHERE entity_type = 'dto' AND entity_slug = ?`)
          .run(nextSlug, slug);
      }

      if (input.tags) this.tags.assignTags('dto', nextSlug, input.tags);

      const updated = this.getBySlugInternal(nextSlug);
      const summary = nextSlug !== slug ? `Renamed from '${slug}' to '${nextSlug}'` : 'Updated';
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('dto', nextSlug, 'update', actor, summary, '1.1.0');
      }
      return { dto: updated, previousSlug: slug };
    });
    const result = tx();
    if (opts.writeFile !== false) {
      const nextSlug = result.dto.slug;
      if (nextSlug !== slug) this.store.remove('dto', slug); // rename: drop the old file
      this.store.persist('dto', nextSlug);
    }
    return result;
  }

  /**
   * Idempotent UPSERT for M17 restore. CREATE if slug missing, UPDATE
   * otherwise; preserves slug.
   */
  upsert(slug: string, input: DtoCreateInput, actor: ChangedBy, opts: MutateOpts = {}): { dto: Dto; op: 'created' | 'updated' } {
    const existing = this.getBySlug(slug);
    if (!existing) {
      const dto = this.create({ ...input, slug } as DtoCreateInput & { slug?: string }, actor, opts);
      return { dto, op: 'created' };
    }
    const { dto } = this.update(slug, {
      name: input.name,
      description: input.description,
      fields: input.fields,
      examples: input.examples,
      tags: input.tags,
    }, actor, opts);
    return { dto, op: 'updated' };
  }

  remove(slug: string, actor: ChangedBy, brokenReferences: BrokenReference[] = [], opts: MutateOpts = {}): DtoDeleteResult {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM dto WHERE slug = ?`).get(slug) as
        | DtoRow
        | undefined;
      if (!row) throw new DomainError('NOT_FOUND', `dto '${slug}' not found`);

      // M17: capture snapshot BEFORE delete (tombstone with last-known data).
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('dto', slug, 'delete', actor, 'Deleted', '1.1.0');
      }
      this.db
        .prepare(`DELETE FROM entity_tag WHERE entity_type = 'dto' AND entity_slug = ?`)
        .run(slug);
      this.db.prepare(`DELETE FROM dto WHERE slug = ?`).run(slug);
      return { deleted: true as const, brokenReferences };
    });
    const result = tx();
    if (opts.writeFile !== false) this.store.remove('dto', slug);
    return result;
  }

  private getBySlugInternal(slug: string): Dto {
    const row = this.db.prepare(`SELECT * FROM dto WHERE slug = ?`).get(slug) as DtoRow | undefined;
    if (!row) throw new Error(`dto '${slug}' disappeared mid-tx`);
    return this.hydrate(row);
  }

  private hydrate(row: DtoRow): Dto {
    return {
      slug: row.slug,
      name: row.name,
      description: row.description,
      fields: parseFields(row.fields),
      examples: parseExamples(row.examples),
      tags: this.tags.getEntityTagSlugs('dto', row.slug),
      endpoints: this.getLinkedEndpoints(row.slug),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getLinkedEndpoints(dtoSlug: string): DtoEndpointLink[] {
    const rows = this.db
      .prepare(
        `SELECT e.slug AS slug, e.method AS method, e.path AS path,
                ed.relation AS relation, ed.status_code AS status_code
           FROM endpoint_dto ed
           JOIN endpoint e ON e.slug = ed.endpoint_slug
          WHERE ed.dto_slug = ?
          ORDER BY ed.relation, ed.status_code, e.path`
      )
      .all(dtoSlug) as Array<{
        slug: string;
        method: string;
        path: string;
        relation: string;
        status_code: number | null;
      }>;
    return rows.map((r) => ({
      endpointSlug: r.slug,
      method: r.method as HttpMethod,
      path: r.path,
      relation: r.relation as EndpointDtoRelation,
      statusCode: r.status_code,
    }));
  }
}

function parseFields(raw: string): DtoField[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f) => f && typeof f === 'object' && typeof f.name === 'string')
      .map((f) => ({
        name: String(f.name),
        type: typeof f.type === 'string' ? f.type : 'any',
        required: Boolean(f.required),
        description: typeof f.description === 'string' ? f.description : undefined,
      }));
  } catch {
    return [];
  }
}

function parseExamples(raw: string): DtoExample[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e === 'object' && typeof e.name === 'string')
      .map((e) => ({
        name: String(e.name),
        summary: typeof e.summary === 'string' ? e.summary : undefined,
        value: e.value,
      }));
  } catch {
    return [];
  }
}

function validateExampleNames(examples: DtoExample[]): void {
  const seen = new Set<string>();
  for (const ex of examples) {
    if (!ex || typeof ex.name !== 'string' || ex.name.length === 0) {
      throw new DomainError('VALIDATION', 'example.name is required');
    }
    if (seen.has(ex.name)) {
      throw new DomainError('EXAMPLE_NAME_CONFLICT', `example name '${ex.name}' is duplicated within DTO`);
    }
    seen.add(ex.name);
  }
}

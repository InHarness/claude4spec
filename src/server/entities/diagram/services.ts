import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type {
  BrokenReference,
  ChangedBy,
  Diagram,
  DiagramCreateInput,
  DiagramDeleteResult,
  DiagramFormat,
  DiagramListQuery,
  DiagramUpdateInput,
} from '../../../shared/entities.js';
import { slugify } from '../../services/slug.js';
import { DomainError } from '../../services/tags.js';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';
import type { EntityStore } from '../../services/entity-store.js';

interface DiagramRow {
  slug: string;
  format: string;
  source: string;
  created_at: string;
  updated_at: string;
}

/**
 * M29 write options — mirror the other entity services. `capture: false`
 * suppresses the entity_version capture (index-rebuild path); `writeFile: false`
 * skips the JSON file persist (the file is what the rebuild reads).
 */
export interface MutateOpts {
  capture?: boolean;
  writeFile?: boolean;
}

const SERIALIZER_VERSION = '1.0.0';

function readFormat(value: unknown): DiagramFormat {
  return value === 'd2' ? 'd2' : 'mermaid';
}

export class DiagramService {
  constructor(
    private db: Database.Database,
    private tags: TagsService,
    private versions: VersionService,
    private store: EntityStore
  ) {}

  // ─── slug generation (decyzja #1 — explicit | slugify(caption) | diagram-<nanoid(8)>) ─

  /** Resolve a free slug, appending `-2`, `-3`, … on collision. */
  private uniqueSlug(base: string): string {
    let candidate = base;
    let n = 2;
    while (this.db.prepare(`SELECT 1 FROM diagram WHERE slug = ?`).get(candidate)) {
      candidate = `${base}-${n}`;
      n += 1;
    }
    return candidate;
  }

  private generateSlug(input: DiagramCreateInput): string {
    const explicit = input.slug?.trim();
    const fromCaption = input.caption ? slugify(input.caption) : '';
    const base = explicit || fromCaption || `diagram-${nanoid(8)}`;
    return this.uniqueSlug(base);
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  create(input: DiagramCreateInput, actor: ChangedBy, opts: MutateOpts = {}): Diagram {
    const slug = this.generateSlug(input);
    if (!slug) throw new DomainError('VALIDATION', 'slug resolves to empty');
    const format = readFormat(input.format);
    const source = input.source ?? '';

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`INSERT INTO diagram (slug, format, source) VALUES (?, ?, ?)`)
        .run(slug, format, source);
      if (input.tags?.length) this.tags.assignTags('diagram', slug, input.tags);
      const created = this.getBySlugInternal(slug);
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('diagram', slug, 'create', actor, 'Created', SERIALIZER_VERSION);
      }
      return created;
    });
    const created = tx();
    if (opts.writeFile !== false) this.store.persist('diagram', created.slug);
    return created;
  }

  list(query: DiagramListQuery = {}): Diagram[] {
    const { whereSql, params } = buildWhere(query);
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    const rows = this.db
      .prepare(`SELECT * FROM diagram ${whereSql} ORDER BY slug LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as DiagramRow[];
    return rows.map((r) => this.hydrate(r));
  }

  count(query: DiagramListQuery = {}): number {
    const { whereSql, params } = buildWhere(query);
    return (
      this.db.prepare(`SELECT COUNT(*) AS c FROM diagram ${whereSql}`).get(...params) as { c: number }
    ).c;
  }

  getBySlug(slug: string): Diagram | null {
    const row = this.db.prepare(`SELECT * FROM diagram WHERE slug = ?`).get(slug) as
      | DiagramRow
      | undefined;
    return row ? this.hydrate(row) : null;
  }

  update(
    slug: string,
    input: DiagramUpdateInput,
    actor: ChangedBy,
    opts: MutateOpts = {}
  ): { diagram: Diagram; previousSlug: string } {
    const tx = this.db.transaction(() => {
      const current = this.db.prepare(`SELECT * FROM diagram WHERE slug = ?`).get(slug) as
        | DiagramRow
        | undefined;
      if (!current) throw new DomainError('NOT_FOUND', `diagram '${slug}' not found`);

      // Slug stable: rename only via explicit newSlug.
      const nextSlug = input.newSlug?.trim() || current.slug;
      if (nextSlug !== slug) {
        const conflict = this.db.prepare(`SELECT 1 FROM diagram WHERE slug = ?`).get(nextSlug);
        if (conflict) throw new DomainError('SLUG_CONFLICT', `diagram slug '${nextSlug}' already exists`);
      }

      const nextFormat = input.format !== undefined ? readFormat(input.format) : current.format;
      const nextSource = input.source !== undefined ? input.source : current.source;

      this.db
        .prepare(
          `UPDATE diagram SET slug = ?, format = ?, source = ?, updated_at = datetime('now')
            WHERE slug = ?`
        )
        .run(nextSlug, nextFormat, nextSource, slug);

      // M29: entity_tag is polymorphic (no FK on entity_slug) — follow the rename.
      if (nextSlug !== slug) {
        this.db
          .prepare(`UPDATE entity_tag SET entity_slug = ? WHERE entity_type = 'diagram' AND entity_slug = ?`)
          .run(nextSlug, slug);
      }

      if (input.tags) this.tags.assignTags('diagram', nextSlug, input.tags);

      const updated = this.getBySlugInternal(nextSlug);
      const summary = nextSlug !== slug ? `Renamed from '${slug}' to '${nextSlug}'` : 'Updated';
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('diagram', nextSlug, 'update', actor, summary, SERIALIZER_VERSION);
      }
      return { diagram: updated, previousSlug: slug };
    });
    const result = tx();
    if (opts.writeFile !== false) {
      const nextSlug = result.diagram.slug;
      if (nextSlug !== slug) this.store.remove('diagram', slug);
      this.store.persist('diagram', nextSlug);
    }
    return result;
  }

  /** Idempotent UPSERT for M17 restore. CREATE if missing, UPDATE otherwise; preserves slug. */
  upsert(
    slug: string,
    input: DiagramCreateInput,
    actor: ChangedBy,
    opts: MutateOpts = {}
  ): { diagram: Diagram; op: 'created' | 'updated' } {
    const existing = this.getBySlug(slug);
    if (!existing) {
      const diagram = this.create({ ...input, slug }, actor, opts);
      return { diagram, op: 'created' };
    }
    const result = this.update(
      slug,
      { format: input.format, source: input.source, tags: input.tags },
      actor,
      opts
    );
    return { diagram: result.diagram, op: 'updated' };
  }

  remove(
    slug: string,
    actor: ChangedBy,
    brokenReferences: BrokenReference[] = [],
    opts: MutateOpts = {}
  ): DiagramDeleteResult {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM diagram WHERE slug = ?`).get(slug) as
        | DiagramRow
        | undefined;
      if (!row) throw new DomainError('NOT_FOUND', `diagram '${slug}' not found`);
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('diagram', slug, 'delete', actor, 'Deleted', SERIALIZER_VERSION);
      }
      this.db
        .prepare(`DELETE FROM entity_tag WHERE entity_type = 'diagram' AND entity_slug = ?`)
        .run(slug);
      this.db.prepare(`DELETE FROM diagram WHERE slug = ?`).run(slug);
      return { deleted: true as const, brokenReferences };
    });
    const result = tx();
    if (opts.writeFile !== false) this.store.remove('diagram', slug);
    return result;
  }

  // ─── hydration ───────────────────────────────────────────────────────────

  private getBySlugInternal(slug: string): Diagram {
    const row = this.db.prepare(`SELECT * FROM diagram WHERE slug = ?`).get(slug) as
      | DiagramRow
      | undefined;
    if (!row) throw new Error(`diagram '${slug}' disappeared mid-tx`);
    return this.hydrate(row);
  }

  private hydrate(row: DiagramRow): Diagram {
    return {
      slug: row.slug,
      format: readFormat(row.format),
      source: row.source,
      tags: this.tags.getEntityTagSlugs('diagram', row.slug),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// ─── list helpers ────────────────────────────────────────────────────────────

function buildWhere(query: DiagramListQuery): { whereSql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.search) {
    where.push(`(slug LIKE ? OR source LIKE ?)`);
    const like = `%${query.search}%`;
    params.push(like, like);
  }

  const tagSlugs = query.tags?.filter(Boolean) ?? [];
  if (tagSlugs.length) {
    const placeholders = tagSlugs.map(() => '?').join(',');
    if (query.tagFilter === 'or') {
      where.push(`
        slug IN (
          SELECT et.entity_slug FROM entity_tag et
           WHERE et.entity_type = 'diagram' AND et.tag_slug IN (${placeholders})
        )
      `);
      params.push(...tagSlugs);
    } else {
      where.push(`
        slug IN (
          SELECT et.entity_slug
            FROM entity_tag et
           WHERE et.entity_type = 'diagram' AND et.tag_slug IN (${placeholders})
        GROUP BY et.entity_slug
          HAVING COUNT(DISTINCT et.tag_slug) = ?
        )
      `);
      params.push(...tagSlugs, tagSlugs.length);
    }
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

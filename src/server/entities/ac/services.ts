import type Database from 'better-sqlite3';
import type {
  Ac,
  AcBrokenVerify,
  AcCreateInput,
  AcDeleteResult,
  AcKind,
  AcListQuery,
  AcStatus,
  AcUpdateInput,
  AcVerifyRef,
  BrokenReference,
  ChangedBy,
} from '../../../shared/entities.js';
import { acSlug } from '../../services/slug.js';
import { DomainError } from '../../services/tags.js';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';
import type { PluginHost } from '../../core/plugin-host/types.js';
import type { EntityStore } from '../../services/entity-store.js';

interface AcRow {
  slug: string;
  text: string;
  kind: string;
  status: string;
  verifies: string;
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

const SERIALIZER_VERSION = '1.0.0';

export interface AcCreateResult {
  ac: Ac;
}

export interface AcUpdateResult {
  ac: Ac;
  previousSlug: string;
}

export class AcService {
  constructor(
    private db: Database.Database,
    private tags: TagsService,
    private versions: VersionService,
    private host: PluginHost,
    private store: EntityStore,
  ) {}

  create(input: AcCreateInput, actor: ChangedBy, opts: MutateOpts = {}): Ac {
    const text = (input.text ?? '').trim();
    if (!text) throw new DomainError('VALIDATION', 'text is required');
    const slug = (input.slug?.trim() || this.allocateSlug(text));
    if (!slug) throw new DomainError('VALIDATION', 'slug resolves to empty');
    const kind = normalizeKind(input.kind);
    const status = normalizeStatus(input.status);
    const verifies = normalizeVerifies(input.verifies);

    const tx = this.db.transaction(() => {
      const conflict = this.db.prepare(`SELECT 1 FROM ac WHERE slug = ?`).get(slug);
      if (conflict) throw new DomainError('SLUG_CONFLICT', `ac slug '${slug}' already exists`);
      this.db
        .prepare(
          `INSERT INTO ac (slug, text, kind, status, verifies, description)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(slug, text, kind, status, JSON.stringify(verifies), input.description ?? null);
      if (input.tags?.length) this.tags.assignTags('ac', slug, input.tags);
      const ac = this.getBySlugInternal(slug);
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('ac', slug, 'create', actor, 'Created', SERIALIZER_VERSION);
      }
      return ac;
    });
    const created = tx();
    // M29: the entity file is the source of truth — persist after the index
    // commit (skipped on the index-rebuild path, opts.writeFile === false).
    if (opts.writeFile !== false) this.store.persist('ac', created.slug);
    return created;
  }

  list(query: AcListQuery = {}): Ac[] {
    const where: string[] = [];
    const params: unknown[] = [];

    const status = query.status ?? 'active';
    if (status !== 'all') {
      where.push(`status = ?`);
      params.push(status);
    }

    if (query.kind) {
      where.push(`kind = ?`);
      params.push(query.kind);
    }

    if (query.search) {
      where.push(`(text LIKE ? OR description LIKE ? OR slug LIKE ?)`);
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
             WHERE et.entity_type = 'ac' AND et.tag_slug IN (${placeholders})
          GROUP BY et.entity_slug
            HAVING COUNT(DISTINCT et.tag_slug) = ?
          )
        `);
        params.push(...tagSlugs, tagSlugs.length);
      } else {
        where.push(`
          slug IN (
            SELECT et.entity_slug FROM entity_tag et
             WHERE et.entity_type = 'ac' AND et.tag_slug IN (${placeholders})
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
        `SELECT * FROM ac ${whereSql}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as AcRow[];

    return rows.map((r) => this.hydrate(r));
  }

  getBySlug(slug: string): Ac | null {
    const row = this.db.prepare(`SELECT * FROM ac WHERE slug = ?`).get(slug) as AcRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  update(slug: string, input: AcUpdateInput, actor: ChangedBy, opts: MutateOpts = {}): AcUpdateResult {
    const tx = this.db.transaction(() => {
      const current = this.db.prepare(`SELECT * FROM ac WHERE slug = ?`).get(slug) as
        | AcRow
        | undefined;
      if (!current) throw new DomainError('NOT_FOUND', `ac '${slug}' not found`);

      const nextText = input.text !== undefined ? input.text.trim() : current.text;
      if (!nextText) throw new DomainError('VALIDATION', 'text resolves to empty');

      const nextSlug = input.newSlug?.trim() || current.slug;
      if (nextSlug !== current.slug) {
        const conflict = this.db.prepare(`SELECT 1 FROM ac WHERE slug = ?`).get(nextSlug);
        if (conflict) throw new DomainError('SLUG_CONFLICT', `ac slug '${nextSlug}' already exists`);
      }

      const nextKind = input.kind !== undefined ? normalizeKind(input.kind) : current.kind;
      const nextStatus = input.status !== undefined ? normalizeStatus(input.status) : current.status;
      const nextVerifies =
        input.verifies !== undefined ? JSON.stringify(normalizeVerifies(input.verifies)) : current.verifies;
      const nextDescription =
        input.description !== undefined ? input.description : current.description;

      this.db
        .prepare(
          `UPDATE ac
             SET slug = ?, text = ?, kind = ?, status = ?, verifies = ?, description = ?,
                 updated_at = datetime('now')
           WHERE slug = ?`,
        )
        .run(
          nextSlug,
          nextText,
          nextKind,
          nextStatus,
          nextVerifies,
          nextDescription,
          slug,
        );

      // M29: a rename moves entity_tag rows to the new slug (entity_tag is
      // polymorphic, no FK on entity_slug — must follow the rename explicitly).
      if (nextSlug !== slug) {
        this.db
          .prepare(`UPDATE entity_tag SET entity_slug = ? WHERE entity_type = 'ac' AND entity_slug = ?`)
          .run(nextSlug, slug);
      }

      if (input.tags) this.tags.assignTags('ac', nextSlug, input.tags);

      const updated = this.getBySlugInternal(nextSlug);
      const summary = nextSlug !== slug ? `Renamed from '${slug}' to '${nextSlug}'` : 'Updated';
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('ac', nextSlug, 'update', actor, summary, SERIALIZER_VERSION);
      }
      return { ac: updated, previousSlug: slug };
    });
    const result = tx();
    if (opts.writeFile !== false) {
      const nextSlug = result.ac.slug;
      if (nextSlug !== slug) this.store.remove('ac', slug); // rename: drop the old file
      this.store.persist('ac', nextSlug);
    }
    return result;
  }

  /** Idempotent UPSERT for M17 restore. */
  upsert(slug: string, input: AcCreateInput, actor: ChangedBy, opts: MutateOpts = {}): { ac: Ac; op: 'created' | 'updated' } {
    const existing = this.getBySlug(slug);
    if (!existing) {
      const ac = this.create({ ...input, slug }, actor, opts);
      return { ac, op: 'created' };
    }
    const { ac } = this.update(
      slug,
      {
        text: input.text,
        kind: input.kind,
        status: input.status,
        verifies: input.verifies,
        description: input.description,
        tags: input.tags,
      },
      actor,
      opts,
    );
    return { ac, op: 'updated' };
  }

  remove(slug: string, actor: ChangedBy, brokenReferences: BrokenReference[] = [], opts: MutateOpts = {}): AcDeleteResult {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM ac WHERE slug = ?`).get(slug) as
        | AcRow
        | undefined;
      if (!row) throw new DomainError('NOT_FOUND', `ac '${slug}' not found`);

      // M17: capture tombstone BEFORE delete.
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('ac', slug, 'delete', actor, 'Deleted', SERIALIZER_VERSION);
      }
      this.db
        .prepare(`DELETE FROM entity_tag WHERE entity_type = 'ac' AND entity_slug = ?`)
        .run(slug);
      this.db.prepare(`DELETE FROM ac WHERE slug = ?`).run(slug);
      return { deleted: true as const, brokenReferences };
    });
    const result = tx();
    if (opts.writeFile !== false) this.store.remove('ac', slug);
    return result;
  }

  /** Resolve verifies refs against the host; non-blocking. */
  classifyVerifies(verifies: AcVerifyRef[]): AcBrokenVerify[] {
    const broken: AcBrokenVerify[] = [];
    for (const ref of verifies) {
      const available = this.host.getAvailable(ref.type);
      if (!available) {
        broken.push({ ...ref, reason: 'unknown' });
        continue;
      }
      if (!this.host.isActive(ref.type)) {
        broken.push({ ...ref, reason: 'inactive' });
        continue;
      }
      if (!this.host.entityExists(ref.type, ref.slug)) {
        broken.push({ ...ref, reason: 'missing' });
      }
    }
    return broken;
  }

  private allocateSlug(text: string): string {
    const base = acSlug(text);
    if (!base) return '';
    let candidate = base;
    let n = 1;
    while (this.db.prepare(`SELECT 1 FROM ac WHERE slug = ?`).get(candidate)) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    return candidate;
  }

  private getBySlugInternal(slug: string): Ac {
    const row = this.db.prepare(`SELECT * FROM ac WHERE slug = ?`).get(slug) as AcRow | undefined;
    if (!row) throw new Error(`ac '${slug}' disappeared mid-tx`);
    return this.hydrate(row);
  }

  private hydrate(row: AcRow): Ac {
    return {
      slug: row.slug,
      text: row.text,
      kind: (row.kind as AcKind) ?? 'requirement',
      status: (row.status as AcStatus) ?? 'active',
      verifies: parseVerifies(row.verifies),
      description: row.description,
      tags: this.tags.getEntityTagSlugs('ac', row.slug),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function normalizeKind(kind: AcKind | undefined): AcKind {
  if (kind === 'edge-case') return 'edge-case';
  return 'requirement';
}

function normalizeStatus(status: AcStatus | undefined): AcStatus {
  if (status === 'deprecated') return 'deprecated';
  return 'active';
}

function normalizeVerifies(verifies: AcVerifyRef[] | undefined): AcVerifyRef[] {
  if (!Array.isArray(verifies)) return [];
  const seen = new Set<string>();
  const out: AcVerifyRef[] = [];
  for (const v of verifies) {
    if (!v || typeof v.type !== 'string' || typeof v.slug !== 'string') continue;
    const type = v.type.trim();
    const slug = v.slug.trim();
    if (!type || !slug) continue;
    const key = `${type} ${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, slug });
  }
  return out;
}

function parseVerifies(raw: string): AcVerifyRef[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeVerifies(parsed as AcVerifyRef[]);
  } catch {
    return [];
  }
}

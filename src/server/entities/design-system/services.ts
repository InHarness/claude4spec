import type Database from 'better-sqlite3';
import type {
  BrokenReference,
  ChangedBy,
  DesignSystem,
  DesignSystemCreateInput,
  DesignSystemDanglingUiView,
  DesignSystemDeleteResult,
  DesignSystemListItem,
  DesignSystemListQuery,
  DesignSystemUpdateInput,
} from '../../../shared/entities.js';
import { lintTokens, parseGroups, parseModes, toListItem } from '../../../shared/design-system.js';
import { designSystemSlug } from '../../services/slug.js';
import { DomainError } from '../../services/tags.js';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';
import type { EntityStore } from '../../services/entity-store.js';

// Re-export the pure token logic so existing importers (serializer, mcp-server)
// keep their `./services.js` import paths.
export { resolve, lintTokens, parseGroups, parseModes, toListItem, aliasTarget } from '../../../shared/design-system.js';

interface DesignSystemRow {
  slug: string;
  name: string;
  description: string | null;
  groups: string;
  modes: string;
  created_at: string;
  updated_at: string;
}

/**
 * M29 write options — mirror UiViewService. `capture: false` suppresses the
 * entity_version capture (index-rebuild path); `writeFile: false` skips the
 * JSON file persist (the file is what the rebuild reads).
 */
export interface MutateOpts {
  capture?: boolean;
  writeFile?: boolean;
}

const SERIALIZER_VERSION = '1.0.0';

export class DesignSystemService {
  constructor(
    private db: Database.Database,
    private tags: TagsService,
    private versions: VersionService,
    private store: EntityStore
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  create(
    input: DesignSystemCreateInput,
    actor: ChangedBy,
    opts: MutateOpts = {}
  ): { designSystem: DesignSystem; warnings: string[] } {
    if (!input.name) throw new DomainError('VALIDATION', 'name is required');
    const slug = input.slug?.trim() || designSystemSlug(input.name);
    if (!slug) throw new DomainError('VALIDATION', 'slug resolves to empty');

    const groups = input.groups ?? [];
    const modes = input.modes ?? [];

    const tx = this.db.transaction(() => {
      const conflict = this.db.prepare(`SELECT 1 FROM design_system WHERE slug = ?`).get(slug);
      if (conflict)
        throw new DomainError('SLUG_CONFLICT', `design system slug '${slug}' already exists`);

      this.db
        .prepare(
          `INSERT INTO design_system (slug, name, description, groups, modes)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(slug, input.name, input.description ?? null, JSON.stringify(groups), JSON.stringify(modes));
      if (input.tags?.length) this.tags.assignTags('design-system', slug, input.tags);
      const created = this.getBySlugInternal(slug);
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot(
          'design-system',
          slug,
          'create',
          actor,
          'Created',
          SERIALIZER_VERSION
        );
      }
      return { designSystem: created, warnings: lintTokens(groups, modes) };
    });
    const created = tx();
    if (opts.writeFile !== false) this.store.persist('design-system', created.designSystem.slug);
    return created;
  }

  list(query: DesignSystemListQuery = {}): DesignSystem[] {
    const { whereSql, params } = buildWhere(query);
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    const rows = this.db
      .prepare(`SELECT * FROM design_system ${whereSql} ORDER BY name LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as DesignSystemRow[];
    return rows.map((r) => this.hydrate(r));
  }

  /** Trimmed list rows + total (ignoring pagination). Counts computed without exposing the token payload. */
  listItems(query: DesignSystemListQuery = {}): { items: DesignSystemListItem[]; total: number } {
    const { whereSql, params } = buildWhere(query);
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM design_system ${whereSql}`).get(...params) as {
        c: number;
      }
    ).c;
    const items = this.list(query).map((ds) => toListItem(ds));
    return { items, total };
  }

  getBySlug(slug: string): DesignSystem | null {
    const row = this.db.prepare(`SELECT * FROM design_system WHERE slug = ?`).get(slug) as
      | DesignSystemRow
      | undefined;
    return row ? this.hydrate(row) : null;
  }

  update(
    slug: string,
    input: DesignSystemUpdateInput,
    actor: ChangedBy,
    opts: MutateOpts = {}
  ): { designSystem: DesignSystem; previousSlug: string; warnings: string[] } {
    const tx = this.db.transaction(() => {
      const current = this.db.prepare(`SELECT * FROM design_system WHERE slug = ?`).get(slug) as
        | DesignSystemRow
        | undefined;
      if (!current) throw new DomainError('NOT_FOUND', `design system '${slug}' not found`);

      const nextName = input.name ?? current.name;
      // Slug stable: name change never regenerates it. Rename only via explicit newSlug.
      const nextSlug = input.newSlug?.trim() || current.slug;
      if (nextSlug !== slug) {
        const conflict = this.db.prepare(`SELECT 1 FROM design_system WHERE slug = ?`).get(nextSlug);
        if (conflict)
          throw new DomainError('SLUG_CONFLICT', `design system slug '${nextSlug}' already exists`);
      }

      // groups/modes: providing the field = full replace of the array.
      const nextGroups = input.groups !== undefined ? JSON.stringify(input.groups) : current.groups;
      const nextModes = input.modes !== undefined ? JSON.stringify(input.modes) : current.modes;

      this.db
        .prepare(
          `UPDATE design_system
             SET slug = ?, name = ?, description = ?, groups = ?, modes = ?,
                 updated_at = datetime('now')
           WHERE slug = ?`
        )
        .run(
          nextSlug,
          nextName,
          input.description !== undefined ? input.description : current.description,
          nextGroups,
          nextModes,
          slug
        );

      // M29: entity_tag is polymorphic (no FK on entity_slug) — follow the rename.
      if (nextSlug !== slug) {
        this.db
          .prepare(
            `UPDATE entity_tag SET entity_slug = ? WHERE entity_type = 'design-system' AND entity_slug = ?`
          )
          .run(nextSlug, slug);
      }

      if (input.tags) this.tags.assignTags('design-system', nextSlug, input.tags);

      const updated = this.getBySlugInternal(nextSlug);
      const summary = nextSlug !== slug ? `Renamed from '${slug}' to '${nextSlug}'` : 'Updated';
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot(
          'design-system',
          nextSlug,
          'update',
          actor,
          summary,
          SERIALIZER_VERSION
        );
      }
      return {
        designSystem: updated,
        previousSlug: slug,
        warnings: lintTokens(updated.groups, updated.modes),
      };
    });
    const result = tx();
    if (opts.writeFile !== false) {
      const nextSlug = result.designSystem.slug;
      if (nextSlug !== slug) this.store.remove('design-system', slug);
      this.store.persist('design-system', nextSlug);
    }
    return result;
  }

  /** Idempotent UPSERT for M17 restore. CREATE if missing, UPDATE otherwise; preserves slug. */
  upsert(
    slug: string,
    input: DesignSystemCreateInput,
    actor: ChangedBy,
    opts: MutateOpts = {}
  ): { designSystem: DesignSystem; op: 'created' | 'updated'; warnings: string[] } {
    const existing = this.getBySlug(slug);
    if (!existing) {
      const result = this.create({ ...input, slug }, actor, opts);
      return { designSystem: result.designSystem, op: 'created', warnings: result.warnings };
    }
    const result = this.update(
      slug,
      {
        name: input.name,
        description: input.description,
        groups: input.groups,
        modes: input.modes,
        tags: input.tags,
      },
      actor,
      opts
    );
    return { designSystem: result.designSystem, op: 'updated', warnings: result.warnings };
  }

  remove(
    slug: string,
    actor: ChangedBy,
    brokenReferences: BrokenReference[] = [],
    opts: MutateOpts = {}
  ): DesignSystemDeleteResult {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM design_system WHERE slug = ?`).get(slug) as
        | DesignSystemRow
        | undefined;
      if (!row) throw new DomainError('NOT_FOUND', `design system '${slug}' not found`);

      // UI views that point at this DS become dangling (the column is kept — warning, not error).
      const danglingUiViews = this.danglingUiViewsFor(slug);

      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot(
          'design-system',
          slug,
          'delete',
          actor,
          'Deleted',
          SERIALIZER_VERSION
        );
      }
      this.db
        .prepare(`DELETE FROM entity_tag WHERE entity_type = 'design-system' AND entity_slug = ?`)
        .run(slug);
      this.db.prepare(`DELETE FROM design_system WHERE slug = ?`).run(slug);
      return { deleted: true as const, brokenReferences, danglingUiViews };
    });
    const result = tx();
    if (opts.writeFile !== false) this.store.remove('design-system', slug);
    return result;
  }

  /** UI views whose `design_system_slug` references the given DS (dangling on delete). */
  private danglingUiViewsFor(slug: string): DesignSystemDanglingUiView[] {
    try {
      const rows = this.db
        .prepare(`SELECT slug FROM ui_view WHERE design_system_slug = ? ORDER BY slug`)
        .all(slug) as Array<{ slug: string }>;
      return rows.map((r) => ({ slug: r.slug }));
    } catch {
      // ui_view table absent (should not happen — migrations always create it).
      return [];
    }
  }

  // ─── hydration ───────────────────────────────────────────────────────────

  private getBySlugInternal(slug: string): DesignSystem {
    const row = this.db.prepare(`SELECT * FROM design_system WHERE slug = ?`).get(slug) as
      | DesignSystemRow
      | undefined;
    if (!row) throw new Error(`design_system '${slug}' disappeared mid-tx`);
    return this.hydrate(row);
  }

  private hydrate(row: DesignSystemRow): DesignSystem {
    return {
      slug: row.slug,
      name: row.name,
      description: row.description,
      groups: parseGroups(row.groups),
      modes: parseModes(row.modes),
      tags: this.tags.getEntityTagSlugs('design-system', row.slug),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// ─── list helpers ────────────────────────────────────────────────────────────

function buildWhere(query: DesignSystemListQuery): { whereSql: string; params: unknown[] } {
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
    if (query.tagFilter === 'or') {
      where.push(`
        slug IN (
          SELECT et.entity_slug FROM entity_tag et
           WHERE et.entity_type = 'design-system' AND et.tag_slug IN (${placeholders})
        )
      `);
      params.push(...tagSlugs);
    } else {
      where.push(`
        slug IN (
          SELECT et.entity_slug
            FROM entity_tag et
           WHERE et.entity_type = 'design-system' AND et.tag_slug IN (${placeholders})
        GROUP BY et.entity_slug
          HAVING COUNT(DISTINCT et.tag_slug) = ?
        )
      `);
      params.push(...tagSlugs, tagSlugs.length);
    }
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}


import type Database from 'better-sqlite3';
import type {
  BrokenReference,
  ChangedBy,
  DatabaseTable,
  DatabaseTableColumn,
  DatabaseTableCreateInput,
  DatabaseTableDanglingFk,
  DatabaseTableDeleteResult,
  DatabaseTableIndex,
  DatabaseTableListQuery,
  DatabaseTableUpdateInput,
} from '../../../shared/entities.js';
import { databaseTableSlug } from '../../services/slug.js';
import { DomainError } from '../../services/tags.js';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';
import type { EntityStore } from '../../services/entity-store.js';

interface DatabaseTableRow {
  slug: string;
  name: string;
  description: string | null;
  columns: string;
  indexes: string;
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

export class DatabaseTableService {
  constructor(
    private db: Database.Database,
    private tags: TagsService,
    private versions: VersionService,
    private store: EntityStore
  ) {}

  create(
    input: DatabaseTableCreateInput,
    actor: ChangedBy,
    opts: MutateOpts = {}
  ): { dbTable: DatabaseTable; warnings: string[] } {
    if (!input.name) throw new DomainError('VALIDATION', 'name is required');
    const slug = input.slug?.trim() || databaseTableSlug(input.name);
    if (!slug) throw new DomainError('VALIDATION', 'slug resolves to empty');

    const columns = input.columns ?? [];
    const indexes = input.indexes ?? [];

    const tx = this.db.transaction(() => {
      const conflict = this.db.prepare(`SELECT 1 FROM database_table WHERE slug = ?`).get(slug);
      if (conflict)
        throw new DomainError(
          'SLUG_CONFLICT',
          `database table slug '${slug}' already exists`
        );

      this.db
        .prepare(
          `INSERT INTO database_table (slug, name, description, columns, indexes)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          slug,
          input.name,
          input.description ?? null,
          JSON.stringify(columns),
          JSON.stringify(indexes)
        );
      if (input.tags?.length) this.tags.assignTags('database-table', slug, input.tags);
      const created = this.getBySlugInternal(slug);
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('database-table', slug, 'create', actor, 'Created', '1.0.0');
      }
      const warnings = this.computeWarnings(columns, slug);
      return { dbTable: created, warnings };
    });
    const created = tx();
    // M29: the entity file is the source of truth — persist after the index
    // commit (skipped on the index-rebuild path, opts.writeFile === false).
    if (opts.writeFile !== false) this.store.persist('database-table', created.dbTable.slug);
    return created;
  }

  list(query: DatabaseTableListQuery = {}): DatabaseTable[] {
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
             WHERE et.entity_type = 'database-table' AND et.tag_slug IN (${placeholders})
          )
        `);
        params.push(...tagSlugs);
      } else {
        where.push(`
          slug IN (
            SELECT et.entity_slug
              FROM entity_tag et
             WHERE et.entity_type = 'database-table' AND et.tag_slug IN (${placeholders})
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
        `SELECT * FROM database_table ${whereSql}
         ORDER BY name
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as DatabaseTableRow[];

    return rows.map((r) => this.hydrate(r));
  }

  getBySlug(slug: string): DatabaseTable | null {
    const row = this.db.prepare(`SELECT * FROM database_table WHERE slug = ?`).get(slug) as
      | DatabaseTableRow
      | undefined;
    return row ? this.hydrate(row) : null;
  }

  update(
    slug: string,
    input: DatabaseTableUpdateInput,
    actor: ChangedBy,
    opts: MutateOpts = {}
  ): { dbTable: DatabaseTable; previousSlug: string; warnings: string[] } {
    const tx = this.db.transaction(() => {
      const current = this.db
        .prepare(`SELECT * FROM database_table WHERE slug = ?`)
        .get(slug) as DatabaseTableRow | undefined;
      if (!current) throw new DomainError('NOT_FOUND', `database table '${slug}' not found`);

      const nextName = input.name ?? current.name;
      const autoSlug = databaseTableSlug(nextName);
      const nextSlug = input.newSlug?.trim() || autoSlug;

      if (nextSlug !== slug) {
        const conflict = this.db
          .prepare(`SELECT 1 FROM database_table WHERE slug = ?`)
          .get(nextSlug);
        if (conflict)
          throw new DomainError(
            'SLUG_CONFLICT',
            `database table slug '${nextSlug}' already exists`
          );
      }

      const nextColumns =
        input.columns !== undefined ? JSON.stringify(input.columns) : current.columns;
      const nextIndexes =
        input.indexes !== undefined ? JSON.stringify(input.indexes) : current.indexes;

      this.db
        .prepare(
          `UPDATE database_table
             SET slug = ?, name = ?, description = ?, columns = ?, indexes = ?,
                 updated_at = datetime('now')
           WHERE slug = ?`
        )
        .run(
          nextSlug,
          nextName,
          input.description !== undefined ? input.description : current.description,
          nextColumns,
          nextIndexes,
          slug
        );

      // M29: a rename moves entity_tag rows to the new slug (entity_tag is
      // polymorphic, no FK on entity_slug — must follow the rename explicitly).
      if (nextSlug !== slug) {
        this.db
          .prepare(`UPDATE entity_tag SET entity_slug = ? WHERE entity_type = 'database-table' AND entity_slug = ?`)
          .run(nextSlug, slug);
      }

      if (input.tags) this.tags.assignTags('database-table', nextSlug, input.tags);

      const updated = this.getBySlugInternal(nextSlug);
      const summary =
        nextSlug !== slug ? `Renamed from '${slug}' to '${nextSlug}'` : 'Updated';
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('database-table', nextSlug, 'update', actor, summary, '1.0.0');
      }
      const warnings = this.computeWarnings(updated.columns, updated.slug);
      return { dbTable: updated, previousSlug: slug, warnings };
    });
    const result = tx();
    if (opts.writeFile !== false) {
      const nextSlug = result.dbTable.slug;
      if (nextSlug !== slug) this.store.remove('database-table', slug); // rename: drop the old file
      this.store.persist('database-table', nextSlug);
    }
    return result;
  }

  /**
   * Idempotent UPSERT for M17 restore. CREATE if slug missing, UPDATE
   * otherwise; preserves slug.
   */
  upsert(
    slug: string,
    input: DatabaseTableCreateInput,
    actor: ChangedBy,
    opts: MutateOpts = {}
  ): { dbTable: DatabaseTable; op: 'created' | 'updated'; warnings: string[] } {
    const existing = this.getBySlug(slug);
    if (!existing) {
      const result = this.create({ ...input, slug }, actor, opts);
      return { dbTable: result.dbTable, op: 'created', warnings: result.warnings };
    }
    const result = this.update(slug, {
      name: input.name,
      description: input.description,
      columns: input.columns,
      indexes: input.indexes,
      tags: input.tags,
    }, actor, opts);
    return { dbTable: result.dbTable, op: 'updated', warnings: result.warnings ?? [] };
  }

  remove(
    slug: string,
    actor: ChangedBy,
    brokenReferences: BrokenReference[] = [],
    opts: MutateOpts = {}
  ): DatabaseTableDeleteResult {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM database_table WHERE slug = ?`).get(slug) as
        | DatabaseTableRow
        | undefined;
      if (!row) throw new DomainError('NOT_FOUND', `database table '${slug}' not found`);

      const danglingFks = this.findDanglingFks(slug);

      // M17: capture snapshot BEFORE delete.
      if (opts.capture !== false) {
        this.versions.captureEntitySnapshot('database-table', slug, 'delete', actor, 'Deleted', '1.0.0');
      }
      this.db
        .prepare(`DELETE FROM entity_tag WHERE entity_type = 'database-table' AND entity_slug = ?`)
        .run(slug);
      this.db.prepare(`DELETE FROM database_table WHERE slug = ?`).run(slug);
      return { deleted: true as const, brokenReferences, danglingFks };
    });
    const result = tx();
    if (opts.writeFile !== false) this.store.remove('database-table', slug);
    return result;
  }

  /**
   * Propagates a slug rename to every other database_table whose columns carry
   * an `fk.table === oldSlug`. Runs in a transaction and snapshots each
   * mutated row via VersionService for an auditable trail.
   */
  propagateFkSlugChange(
    oldSlug: string,
    newSlug: string,
    actor: ChangedBy
  ): { changedTables: string[] } {
    if (oldSlug === newSlug) return { changedTables: [] };
    const changedTables: string[] = [];

    const tx = this.db.transaction(() => {
      const like = `%"table":"${oldSlug}"%`;
      const rows = this.db
        .prepare(
          `SELECT slug, columns FROM database_table
            WHERE slug != ? AND columns LIKE ?`
        )
        .all(newSlug, like) as Array<{ slug: string; columns: string }>;

      for (const row of rows) {
        const columns = parseColumns(row.columns);
        let mutated = false;
        const nextColumns = columns.map((col) => {
          if (col.fk && col.fk.table === oldSlug) {
            mutated = true;
            return { ...col, fk: { ...col.fk, table: newSlug } };
          }
          return col;
        });
        if (!mutated) continue;

        this.db
          .prepare(
            `UPDATE database_table
               SET columns = ?, updated_at = datetime('now')
             WHERE slug = ?`
          )
          .run(JSON.stringify(nextColumns), row.slug);
        const updated = this.getBySlugInternal(row.slug);
        this.versions.captureEntitySnapshot(
          'database-table',
          row.slug,
          'update',
          actor,
          `FK slug propagation: '${oldSlug}' → '${newSlug}'`,
          '1.0.0'
        );
        changedTables.push(row.slug);
      }
    });
    tx();
    // M29: each propagated row's snapshot (its fk.table) changed — persist its
    // file. No opts here (this path has no writeFile gate), so persist always.
    for (const changedSlug of changedTables) this.store.persist('database-table', changedSlug);
    return { changedTables };
  }

  /** Tables whose columns carry `fk.table === targetSlug`. */
  findDanglingFks(targetSlug: string): DatabaseTableDanglingFk[] {
    const like = `%"table":"${targetSlug}"%`;
    const rows = this.db
      .prepare(
        `SELECT slug, columns FROM database_table
          WHERE slug != ? AND columns LIKE ?`
      )
      .all(targetSlug, like) as Array<{ slug: string; columns: string }>;
    const out: DatabaseTableDanglingFk[] = [];
    for (const row of rows) {
      const columns = parseColumns(row.columns);
      for (const col of columns) {
        if (col.fk?.table === targetSlug) {
          out.push({ tableSlug: row.slug, columnName: col.name });
        }
      }
    }
    return out;
  }

  private getBySlugInternal(slug: string): DatabaseTable {
    const row = this.db.prepare(`SELECT * FROM database_table WHERE slug = ?`).get(slug) as
      | DatabaseTableRow
      | undefined;
    if (!row) throw new Error(`database table '${slug}' disappeared mid-tx`);
    return this.hydrate(row);
  }

  private hydrate(row: DatabaseTableRow): DatabaseTable {
    return {
      slug: row.slug,
      name: row.name,
      description: row.description,
      columns: parseColumns(row.columns),
      indexes: parseIndexes(row.indexes),
      tags: this.tags.getEntityTagSlugs('database-table', row.slug),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private computeWarnings(columns: DatabaseTableColumn[], selfSlug: string): string[] {
    const warnings: string[] = [];
    const knownTables = new Map<string, DatabaseTableColumn[]>();
    const rows = this.db
      .prepare(`SELECT slug, columns FROM database_table`)
      .all() as Array<{ slug: string; columns: string }>;
    for (const r of rows) knownTables.set(r.slug, parseColumns(r.columns));
    for (const col of columns) {
      if (col.enumValues && col.enumValues.length > 0 && col.type !== 'enum') {
        warnings.push(
          `Column '${col.name}': enumValues set but type is '${col.type}' (expected 'enum') — enumValues will be ignored.`
        );
      }
      if (col.fk) {
        const target = col.fk.table;
        const targetColumns =
          target === selfSlug ? columns : knownTables.get(target);
        if (!targetColumns) {
          warnings.push(
            `Column '${col.name}': fk.table '${target}' does not exist yet.`
          );
        } else {
          const targetCol = targetColumns.find((c) => c.name === col.fk!.column);
          if (!targetCol) {
            warnings.push(
              `Column '${col.name}': fk.column '${col.fk.column}' not found in table '${target}'.`
            );
          }
        }
      }
    }
    return warnings;
  }
}

function parseColumns(raw: string): DatabaseTableColumn[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c) => c && typeof c === 'object' && typeof c.name === 'string')
      .map((c) => {
        const col: DatabaseTableColumn = {
          name: String(c.name),
          type: typeof c.type === 'string' ? c.type : 'string',
        };
        if (typeof c.nullable === 'boolean') col.nullable = c.nullable;
        if (typeof c.unique === 'boolean') col.unique = c.unique;
        if (typeof c.pk === 'boolean') col.pk = c.pk;
        if (c.fk && typeof c.fk === 'object' && typeof c.fk.table === 'string') {
          col.fk = { table: String(c.fk.table), column: String(c.fk.column ?? '') };
        }
        if (typeof c.default === 'string') col.default = c.default;
        if (Array.isArray(c.enumValues)) {
          col.enumValues = c.enumValues.filter((v: unknown) => typeof v === 'string') as string[];
        }
        if (typeof c.description === 'string') col.description = c.description;
        return col;
      });
  } catch {
    return [];
  }
}

function parseIndexes(raw: string): DatabaseTableIndex[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((i) => i && typeof i === 'object' && Array.isArray(i.columns))
      .map((i) => {
        const idx: DatabaseTableIndex = {
          columns: (i.columns as unknown[]).filter((c) => typeof c === 'string') as string[],
        };
        if (typeof i.unique === 'boolean') idx.unique = i.unique;
        if (typeof i.name === 'string') idx.name = i.name;
        return idx;
      });
  } catch {
    return [];
  }
}

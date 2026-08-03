import type Database from 'better-sqlite3';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { compositionOf } from '../../shared/plugin-host/composition.js';
import { toIsoMs, type SystemStamp } from '../serialization/system-fields.js';

export type RawEntityType =
  | 'endpoint'
  | 'dto'
  | 'database-table'
  | 'ui-view'
  | 'ac'
  | 'design-system'
  | 'diagram';

export interface RawEntity {
  type: string;
  slug: string;
  data: Record<string, unknown>;
  tags: string[];
  /**
   * 0.2.4: the entity's `createdAt`/`updatedAt`, kept OUT of `data` (where the
   * raw columns were always stripped) and read back off the audit columns.
   *
   * Reading them off the row is reading them off the file: since 0.2.4 the
   * write path only ever copies the file's value into the column, so the two
   * are the same value by construction. Absent when the type's table has no
   * audit columns, or when they are unparseable.
   */
  system?: SystemStamp;
}

export interface RawSection {
  /**
   * M39: the `section_index.rootId` column has existed since migration 044, but
   * nothing ever read it back out — every consumer re-derived the built-in
   * `pages` root. A discovery operation addresses a page as `(rootId, path)`,
   * so a section that cannot name its own root cannot be turned back into a
   * page address.
   */
  rootId: string;
  anchor: string;
  pagePath: string;
  headingPath: string;
  headingSlug: string;
  headingText: string;
  headingLevel: number;
  contentHash: string;
  lineStart: number;
  lineEnd: number;
}

/** Per-entity-type counts. Keys are plugin types; absent type = 0. */
export type RawTagCounts = Record<string, number>;

export interface RawTag {
  slug: string;
  name: string;
  color: string | null;
  description: string | null;
  counts: RawTagCounts;
}

export interface FindByTagParams {
  type?: string;
  tags: string[];
  filter: 'and' | 'or';
}

export interface SectionEntityRef {
  anchor: string;
  pagePath: string;
  headingText: string;
  relation: string;
}

const ENTITY_TABLES: Record<RawEntityType, string> = {
  endpoint: 'endpoint',
  dto: 'dto',
  'database-table': 'database_table',
  'ui-view': 'ui_view',
  ac: 'ac',
  'design-system': 'design_system',
  diagram: 'diagram',
};

const ALL_ENTITY_TYPES: RawEntityType[] = [
  'endpoint',
  'dto',
  'database-table',
  'ui-view',
  'ac',
  'design-system',
  'diagram',
];

export function isRawEntityType(value: string): value is RawEntityType {
  return (
    value === 'endpoint' ||
    value === 'dto' ||
    value === 'database-table' ||
    value === 'ui-view' ||
    value === 'ac' ||
    value === 'design-system' ||
    value === 'diagram'
  );
}

export class RawEntityReader {
  constructor(
    /**
     * 0.2.2 — public, deliberately. The escape hatch for a module whose type
     * owns AUXILIARY tables the generic single-row read cannot express: a
     * junction, a side index. `endpoint`'s serializer reaches its `endpoint_dto`
     * links through `ctx.reader.db`, because `SerializeContext` carries the
     * reader and nothing else, and widening that context would change a shape
     * every installed plugin compiles against.
     *
     * Not an invitation to query another module's tables. A module may touch
     * what it declared; the host itself must keep going through the typed API.
     */
    readonly db: Database.Database,
    /**
     * M17: write-path capture needs to read a plugin-contributed type's raw
     * row before snapshotting, not just the 7 core types. Optional — callers
     * that only ever touch core types (CLI tools, reference-tools,
     * ac-analysis) keep working unchanged without a host.
     *
     * 0.2.2 — public for the same reason as `db` above: a module's restore path
     * needs the service resolver (`getEntityService`) to drive its own auxiliary
     * writes, and `RestoreContext` carries the reader and the writer, nothing
     * else.
     */
    readonly host?: ProjectPluginHost,
  ) {}

  /**
   * Resolves the SQL table for `type` — and only if that table actually exists.
   *
   * The name comes from the static `ENTITY_TABLES` map (identical behavior/perf
   * for the 7 core types) or, for a plugin type, from
   * `host.getEntity(type)?.table` — the same `EntityModuleManifest.table` field
   * `auto-schema.ts#resolveTable` already uses for schema introspection.
   * `getEntity` (not `getAvailable`) so an inactive/deactivated plugin type
   * resolves to nothing here too, matching every other host-gated read.
   *
   * 0.2.2 — the EXISTENCE check is the load-bearing half, and it is new. A name
   * in that static map used to imply a table, because the host's own migration
   * chain created all seven unconditionally. Now every entity table is created
   * by the module that owns it, and two of those modules live in a builtin
   * envelope the host loads FAIL-SOFT: a missing or unimportable
   * `dist/plugins/…` bundle leaves `endpoint` and `dto` with no module and no
   * table, while this map still happily answers `'endpoint'`. Every read then
   * threw `no such table` — `find_by_tag`, a mixed `<tagged_list>` on a page,
   * `listSlugs` — where the design says such a type is simply ABSENT. Guarding
   * one caller (`count`) fixed one symptom; guarding the resolver fixes the
   * class, and keeps `hasTable` honest for the callers that must fail loudly.
   */
  private resolveTable(type: string): string | undefined {
    // 0.2.4: the descriptor is the source; ENTITY_TABLES survives only as the
    // host-less fallback and is deleted once every reader is built with a host.
    const table =
      compositionOf(this.host?.getEntity(type))?.mainTable ?? ENTITY_TABLES[type as RawEntityType];
    if (!table) return undefined;
    return this.tableExists(table) ? table : undefined;
  }

  /**
   * Memoized POSITIVE results only. A table that exists cannot vanish inside a
   * process, so caching that is safe; a table that is missing may still be
   * created by a migration that has not run yet, so a negative answer is never
   * cached. Absent types are the rare case, so the re-query costs little.
   */
  private readonly knownTables = new Set<string>();

  private tableExists(table: string): boolean {
    if (this.knownTables.has(table)) return true;
    const found =
      this.db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?`)
        .get(table) !== undefined;
    if (found) this.knownTables.add(table);
    return found;
  }

  /** Memoized `ORDER BY` clause per table — the `PRAGMA` runs once per table. */
  private readonly orderClauses = new Map<string, string>();

  /**
   * 0.2.4 — THE default list order: `created_at ASC, slug ASC`, for every type,
   * on every transport.
   *
   * Before this, order was whatever each service happened to write: `name` for
   * three types, `slug` for one, `path, method` for another, `created_at DESC`
   * for `ac`. So the same entity set came back in a different order from the
   * UI, REST, MCP and the CLI, and the boot rebuild reshuffled `ac` because
   * `created_at` was re-minted on every index pass. With the timestamp now
   * owned by the file, `created_at` is stable and means what it says.
   *
   * ASCENDING because this is presentation order, not ranking order — a list of
   * acceptance criteria reads oldest-first like a document, and "newest first"
   * is a ranking reflex that belongs to search. `slug` breaks ties, which is
   * what stops `LIMIT`/`OFFSET` paging from losing or duplicating rows when two
   * entities share a timestamp (the common case right after a rebuild).
   *
   * Falls back to `slug` alone when the table has no `created_at` — a
   * plugin-contributed table is not required to have one, and an ordering
   * helper must never be the reason a read throws.
   */
  private orderClause(table: string): string {
    const cached = this.orderClauses.get(table);
    if (cached) return cached;
    let clause = 'slug';
    try {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
      if (columns.some((c) => c.name === 'created_at')) clause = 'created_at, slug';
    } catch {
      /* unreadable pragma — `slug` is always safe */
    }
    this.orderClauses.set(table, clause);
    return clause;
  }

  /**
   * Whether `type` resolves to a real table — distinguishes "this type can't
   * be read at all" (misconfigured/inactive plugin, or a reader built without
   * a host) from "the table exists but this slug isn't in it." Callers that
   * need to fail loudly on the former (e.g. M17 capture) check this instead
   * of treating `getEntity`'s null return as ordinary absence.
   */
  hasTable(type: string): boolean {
    return this.resolveTable(type) !== undefined;
  }

  getEntity(type: string, slug: string): RawEntity | null {
    const table = this.resolveTable(type);
    if (!table) return null;
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE slug = ?`).get(slug) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.hydrate(type, row);
  }

  getEntities(type: string, slugs: string[]): { items: RawEntity[]; missing: string[] } {
    const items: RawEntity[] = [];
    const missing: string[] = [];
    for (const slug of slugs) {
      const entity = this.getEntity(type, slug);
      if (entity) items.push(entity);
      else missing.push(slug);
    }
    return { items, missing };
  }

  findByTag(params: FindByTagParams): RawEntity[] {
    const tagSlugs = params.tags.filter(Boolean);
    if (!tagSlugs.length) return [];
    // Untyped sweep goes through `listTypes()` for the same reason it exists:
    // a tag on a plugin-contributed entity is still a tag, and the frozen
    // seven-type list made those entities unreachable by tag alone.
    const types = params.type ? [params.type] : this.listTypes();
    const out: RawEntity[] = [];
    for (const type of types) {
      out.push(...this.findByTagForType(type, tagSlugs, params.filter));
    }
    return out;
  }

  private findByTagForType(
    type: string,
    tagSlugs: string[],
    filter: 'and' | 'or'
  ): RawEntity[] {
    // 0.2.2: via `resolveTable`, not the static map — see `listSlugs`.
    const table = this.resolveTable(type);
    if (!table) return [];
    const placeholders = tagSlugs.map(() => '?').join(',');
    // Qualified with the `e` alias — the subquery below also has a `slug`.
    const order = this.orderClause(table)
      .split(', ')
      .map((column) => `e.${column}`)
      .join(', ');
    let sql: string;
    const params: unknown[] = [];
    if (filter === 'and') {
      sql = `
        SELECT e.* FROM ${table} e
         WHERE e.slug IN (
          SELECT et.entity_slug
            FROM entity_tag et
           WHERE et.entity_type = ? AND et.tag_slug IN (${placeholders})
        GROUP BY et.entity_slug
          HAVING COUNT(DISTINCT et.tag_slug) = ?
         )
         ORDER BY ${order}
      `;
      params.push(type, ...tagSlugs, tagSlugs.length);
    } else {
      sql = `
        SELECT e.* FROM ${table} e
         WHERE e.slug IN (
          SELECT et.entity_slug FROM entity_tag et
           WHERE et.entity_type = ? AND et.tag_slug IN (${placeholders})
         )
         ORDER BY ${order}
      `;
      params.push(type, ...tagSlugs);
    }
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => this.hydrate(type, row));
  }

  getSection(anchor: string): RawSection | null {
    const row = this.db
      .prepare('SELECT * FROM section_index WHERE anchor = ?')
      .get(anchor) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.hydrateSection(row);
  }

  /**
   * The types this reader can actually address.
   *
   * M39: was a frozen list of the seven core types, which made every consumer
   * of `listTypes` (entity counts, the M29 export sweep, `check_consistency`)
   * blind to plugin-contributed types — they existed in the host and had rows
   * in their own table, and the reader claimed they were not there. Now the
   * host is the source: `listEntities()` is already the ACTIVE set, so a
   * deactivated type drops out here for free.
   *
   * Without a host the reader keeps answering the seven core types, because a
   * host is optional by construction (CLI tools, ac-analysis) and returning
   * nothing would silently empty those sweeps rather than fail them.
   */
  listTypes(): string[] {
    if (!this.host) return [...ALL_ENTITY_TYPES];
    return this.host.listEntities().map((m) => m.type);
  }

  /**
   * Slugs currently indexed for `type`.
   *
   * 0.2.2: resolves through `resolveTable` (static map, then
   * `host.getEntity(type).table`) rather than indexing the static map directly.
   * `ReleaseService.restoreSpec` now iterates EVERY active module, not the four
   * hardcoded core types, so a plugin-contributed type reaches this method — and
   * `ENTITY_TABLES['use-case']` being `undefined` produced
   * `SELECT slug FROM undefined`, a SqliteError thrown OUTSIDE restoreSpec's
   * per-slug try/catch that aborted the whole restore half-applied.
   *
   * An unresolvable type returns `[]`: "nothing indexed for a type this project
   * cannot address" is the honest answer, and it keeps the caller on its normal
   * path instead of exploding.
   */
  listSlugs(type: string): string[] {
    const table = this.resolveTable(type);
    if (!table) return [];
    const rows = this.db
      .prepare(`SELECT slug FROM ${table} ORDER BY ${this.orderClause(table)}`)
      .all() as Array<{ slug: string }>;
    return rows.map((r) => r.slug);
  }

  /** Cheap row count for a type — used by `catalog`. */
  count(type: string): number {
    // `resolveTable` already answers undefined for a type with no table, so an
    // absent type reads as zero rather than throwing. The caller is
    // `GET /entities/counts`, where one throw blanked every badge in the
    // sidebar, not just the one type's.
    const table = this.resolveTable(type);
    if (!table) return 0;
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
    return row.c;
  }

  listTags(): RawTag[] {
    const rows = this.db.prepare(`SELECT * FROM tag ORDER BY name`).all() as Array<{
      slug: string;
      name: string;
      color: string | null;
      description: string | null;
    }>;
    /**
     * 0.2.7 — counts are over the ACTIVE types only.
     *
     * They always claimed to be ("a cartesian product of tags × active types"),
     * and `GET /api/tags` has always filtered — but this query did not, and the
     * discrepancy was invisible while the rebuild wiped `entity_tag` wholesale:
     * a deactivated type had no rows left to count. Now that its assignments
     * survive the rebuild, an unfiltered count would report entities under a
     * type with zero rows, and the REST and discovery surfaces would answer
     * differently for the same project.
     */
    const active = this.listTypes();
    if (active.length === 0) return rows.map((r) => ({ ...r, counts: {} }));
    const countRows = this.db
      .prepare(
        `SELECT et.tag_slug AS slug, et.entity_type AS entity_type, COUNT(*) AS c
           FROM entity_tag et
          WHERE et.entity_type IN (${active.map(() => '?').join(', ')})
         GROUP BY et.tag_slug, et.entity_type`
      )
      .all(...active) as Array<{ slug: string; entity_type: string; c: number }>;

    const countMap = new Map<string, RawTagCounts>();
    for (const row of countRows) {
      const entry: RawTagCounts = countMap.get(row.slug) ?? {};
      entry[row.entity_type] = row.c;
      countMap.set(row.slug, entry);
    }

    return rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      color: r.color,
      description: r.description,
      counts:
        countMap.get(r.slug) ?? {
          endpoint: 0,
          dto: 0,
          'database-table': 0,
          'ui-view': 0,
          ac: 0,
          'design-system': 0,
          diagram: 0,
        },
    }));
  }

  /** Returns sections that referenced the given entity (populated by section-indexer). */
  findSectionReferences(type: string, slug: string): SectionEntityRef[] {
    const rows = this.db
      .prepare(
        `SELECT sel.anchor AS anchor, sel.relation AS relation,
                si.page_path AS page_path, si.heading_text AS heading_text
           FROM section_entity_link sel
           JOIN section_index si ON si.anchor = sel.anchor
          WHERE sel.entity_type = ? AND sel.entity_slug = ?
          ORDER BY si.page_path, si.line_start`
      )
      .all(type, slug) as Array<{
        anchor: string;
        relation: string;
        page_path: string;
        heading_text: string;
      }>;
    return rows.map((r) => ({
      anchor: r.anchor,
      pagePath: r.page_path,
      headingText: r.heading_text,
      relation: r.relation,
    }));
  }


  private hydrate(type: string, row: Record<string, unknown>): RawEntity {
    const slug = row.slug as string;
    const tags = this.getEntityTagSlugs(type, slug);

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === 'created_at' || key === 'updated_at') continue;
      data[key] = value;
    }

    // Generic JSON column hydration: any string column whose value parses as
    // a JSON array/object gets decoded. Replaces per-entity-type branches
    // (dto.fields, dto.examples, database-table.columns/indexes, ui-view.params).
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trimStart();
      if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) continue;
      data[key] = safeJsonArray(value);
    }

    const createdAt = toIsoMs(row.created_at);
    const updatedAt = toIsoMs(row.updated_at);
    const system = createdAt && updatedAt ? { createdAt, updatedAt } : undefined;

    return { type, slug, data, tags, ...(system ? { system } : {}) };
  }

  private hydrateSection(row: Record<string, unknown>): RawSection {
    return {
      rootId: row.rootId as string,
      contentHash: row.content_hash as string,
      anchor: row.anchor as string,
      pagePath: row.page_path as string,
      headingPath: row.heading_path as string,
      headingSlug: row.heading_slug as string,
      headingText: row.heading_text as string,
      headingLevel: row.heading_level as number,
      lineStart: row.line_start as number,
      lineEnd: row.line_end as number,
    };
  }

  private getEntityTagSlugs(type: string, slug: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT t.slug AS slug
           FROM entity_tag et
           JOIN tag t ON t.slug = et.tag_slug
          WHERE et.entity_type = ? AND et.entity_slug = ?
          ORDER BY t.name`
      )
      .all(type, slug) as Array<{ slug: string }>;
    return rows.map((r) => r.slug);
  }
}

function safeJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

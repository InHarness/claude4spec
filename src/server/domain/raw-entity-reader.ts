import type Database from 'better-sqlite3';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

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
}

export interface RawSection {
  anchor: string;
  pagePath: string;
  headingPath: string;
  headingSlug: string;
  headingText: string;
  headingLevel: number;
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
  type?: RawEntityType;
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
    private db: Database.Database,
    /**
     * M17: write-path capture needs to read a plugin-contributed type's raw
     * row before snapshotting, not just the 7 core types. Optional — callers
     * that only ever touch core types (CLI tools, reference-tools,
     * ac-analysis) keep working unchanged without a host.
     */
    private host?: ProjectPluginHost,
  ) {}

  /**
   * Resolves the SQL table for `type`. The static `ENTITY_TABLES` map is
   * checked first (identical behavior/perf for the 7 core types); a plugin
   * type falls back to `host.getEntity(type)?.table` — the same
   * `EntityModuleManifest.table` field `auto-schema.ts#resolveTable` already
   * uses for schema introspection. `getEntity` (not `getAvailable`) so an
   * inactive/deactivated plugin type resolves to no table here too, matching
   * every other host-gated read. No static list gates capture anymore.
   */
  private resolveTable(type: string): string | undefined {
    return ENTITY_TABLES[type as RawEntityType] ?? this.host?.getEntity(type)?.table;
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

  getEntities(type: RawEntityType, slugs: string[]): { items: RawEntity[]; missing: string[] } {
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
    const types = params.type ? [params.type] : ALL_ENTITY_TYPES;
    const out: RawEntity[] = [];
    for (const type of types) {
      out.push(...this.findByTagForType(type, tagSlugs, params.filter));
    }
    return out;
  }

  private findByTagForType(
    type: RawEntityType,
    tagSlugs: string[],
    filter: 'and' | 'or'
  ): RawEntity[] {
    const table = ENTITY_TABLES[type];
    const placeholders = tagSlugs.map(() => '?').join(',');
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
         ORDER BY e.slug
      `;
      params.push(type, ...tagSlugs, tagSlugs.length);
    } else {
      sql = `
        SELECT e.* FROM ${table} e
         WHERE e.slug IN (
          SELECT et.entity_slug FROM entity_tag et
           WHERE et.entity_type = ? AND et.tag_slug IN (${placeholders})
         )
         ORDER BY e.slug
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

  listTypes(): RawEntityType[] {
    return [...ALL_ENTITY_TYPES];
  }

  listSlugs(type: RawEntityType): string[] {
    const table = ENTITY_TABLES[type];
    const rows = this.db
      .prepare(`SELECT slug FROM ${table} ORDER BY slug`)
      .all() as Array<{ slug: string }>;
    return rows.map((r) => r.slug);
  }

  /** Cheap row count for a type — used by `catalog`. */
  count(type: RawEntityType): number {
    const table = ENTITY_TABLES[type];
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
    const countRows = this.db
      .prepare(
        `SELECT et.tag_slug AS slug, et.entity_type AS entity_type, COUNT(*) AS c
           FROM entity_tag et
         GROUP BY et.tag_slug, et.entity_type`
      )
      .all() as Array<{ slug: string; entity_type: string; c: number }>;

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
  findSectionReferences(type: RawEntityType, slug: string): SectionEntityRef[] {
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

  /** Endpoint-DTO links (denormalised). */
  findEndpointDtos(
    endpointSlug: string
  ): Array<{ dtoSlug: string; dtoName: string; relation: string; statusCode: number | null }> {
    const rows = this.db
      .prepare(
        `SELECT d.slug AS dto_slug, d.name AS dto_name,
                ed.relation AS relation, ed.status_code AS status_code
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
      relation: r.relation,
      statusCode: r.status_code,
    }));
  }

  /** Reverse: endpoints linked to a DTO. */
  findDtoEndpoints(
    dtoSlug: string
  ): Array<{
    endpointSlug: string;
    method: string;
    path: string;
    relation: string;
    statusCode: number | null;
  }> {
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
      method: r.method,
      path: r.path,
      relation: r.relation,
      statusCode: r.status_code,
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

    return { type, slug, data, tags };
  }

  private hydrateSection(row: Record<string, unknown>): RawSection {
    return {
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

import type Database from 'better-sqlite3';

export type RawEntityType = 'endpoint' | 'dto' | 'database-table' | 'ui-view' | 'ac';

export interface RawEntity {
  type: RawEntityType;
  id: number;
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
};

const ALL_ENTITY_TYPES: RawEntityType[] = ['endpoint', 'dto', 'database-table', 'ui-view', 'ac'];

export function isRawEntityType(value: string): value is RawEntityType {
  return (
    value === 'endpoint' ||
    value === 'dto' ||
    value === 'database-table' ||
    value === 'ui-view' ||
    value === 'ac'
  );
}

export class RawEntityReader {
  constructor(private db: Database.Database) {}

  getEntity(type: RawEntityType, slug: string): RawEntity | null {
    const table = ENTITY_TABLES[type];
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE slug = ?`).get(slug) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.hydrate(type, row);
  }

  getEntityById(type: RawEntityType, id: number): RawEntity | null {
    const table = ENTITY_TABLES[type];
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
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
         WHERE e.id IN (
          SELECT et.entity_id
            FROM entity_tag et
            JOIN tag t ON t.id = et.tag_id
           WHERE et.entity_type = ? AND t.slug IN (${placeholders})
        GROUP BY et.entity_id
          HAVING COUNT(DISTINCT t.slug) = ?
         )
         ORDER BY e.slug
      `;
      params.push(type, ...tagSlugs, tagSlugs.length);
    } else {
      sql = `
        SELECT e.* FROM ${table} e
         WHERE e.id IN (
          SELECT et.entity_id FROM entity_tag et
            JOIN tag t ON t.id = et.tag_id
           WHERE et.entity_type = ? AND t.slug IN (${placeholders})
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

  listTags(): RawTag[] {
    const rows = this.db.prepare(`SELECT * FROM tag ORDER BY name`).all() as Array<{
      id: number;
      slug: string;
      name: string;
      color: string | null;
      description: string | null;
    }>;
    const countRows = this.db
      .prepare(
        `SELECT t.slug AS slug, et.entity_type AS entity_type, COUNT(*) AS c
           FROM entity_tag et
           JOIN tag t ON t.id = et.tag_id
         GROUP BY t.slug, et.entity_type`
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
        countMap.get(r.slug) ?? { endpoint: 0, dto: 0, 'database-table': 0, 'ui-view': 0, ac: 0 },
    }));
  }

  /** Returns sections that referenced the given entity (populated by section-indexer). */
  findSectionReferences(type: RawEntityType, entityId: number): SectionEntityRef[] {
    const rows = this.db
      .prepare(
        `SELECT sel.anchor AS anchor, sel.relation AS relation,
                si.page_path AS page_path, si.heading_text AS heading_text
           FROM section_entity_link sel
           JOIN section_index si ON si.anchor = sel.anchor
          WHERE sel.entity_type = ? AND sel.entity_id = ?
          ORDER BY si.page_path, si.line_start`
      )
      .all(type, entityId) as Array<{
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
    endpointId: number
  ): Array<{ dtoSlug: string; dtoName: string; relation: string; statusCode: number | null }> {
    const rows = this.db
      .prepare(
        `SELECT d.slug AS dto_slug, d.name AS dto_name,
                ed.relation AS relation, ed.status_code AS status_code
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
      relation: r.relation,
      statusCode: r.status_code,
    }));
  }

  /** Reverse: endpoints linked to a DTO. */
  findDtoEndpoints(
    dtoId: number
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
           JOIN endpoint e ON e.id = ed.endpoint_id
          WHERE ed.dto_id = ?
          ORDER BY ed.relation, ed.status_code, e.path`
      )
      .all(dtoId) as Array<{
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

  private hydrate(type: RawEntityType, row: Record<string, unknown>): RawEntity {
    const id = row.id as number;
    const slug = row.slug as string;
    const tags = this.getEntityTagSlugs(type, id);

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === 'id' || key === 'created_at' || key === 'updated_at') continue;
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

    return { type, id, slug, data, tags };
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

  private getEntityTagSlugs(type: RawEntityType, entityId: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT t.slug AS slug
           FROM entity_tag et
           JOIN tag t ON t.id = et.tag_id
          WHERE et.entity_type = ? AND et.entity_id = ?
          ORDER BY t.name`
      )
      .all(type, entityId) as Array<{ slug: string }>;
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

import type Database from 'better-sqlite3';
import type { JsonSchema } from './types.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

const AUDIT_COLUMNS = new Set(['id', 'created_at', 'updated_at']);
const JSON_COLUMN_HINTS = new Set(['fields', 'columns', 'indexes']);

/** Non-entity types whose table is owned by a feature module (M06 sections, ...). */
const NON_ENTITY_TABLES: Record<string, string> = {
  section: 'section_index',
};

function resolveTable(type: string, host: ProjectPluginHost): string | undefined {
  if (NON_ENTITY_TABLES[type]) return NON_ENTITY_TABLES[type];
  // Use getAvailable so auto-schema works even when type is registered but
  // currently inactive (catalog/CLI/MCP enumerate inactive types for diagnostics).
  return host.getAvailable(type)?.table;
}

export function autoDerivedSchema(db: Database.Database, type: string, host: ProjectPluginHost): JsonSchema {
  const table = resolveTable(type, host);
  if (!table) {
    return { type: 'object', _auto: true, _note: `no table mapping for entity type '${type}'` };
  }
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const col of rows) {
      if (AUDIT_COLUMNS.has(col.name)) continue;
      properties[col.name] = JSON_COLUMN_HINTS.has(col.name)
        ? { type: 'array', items: { type: 'object' } }
        : { type: sqlToJsonType(col.type) };
      if (col.notnull === 1) required.push(col.name);
    }
    properties.tags = { type: 'array', items: { type: 'string' } };
    return {
      type: 'object',
      properties,
      required,
      _auto: true,
    };
  } catch (err) {
    return { type: 'object', _auto: true, _error: (err as Error).message };
  }
}

function sqlToJsonType(sqlType: string): string {
  const upper = sqlType.toUpperCase();
  if (upper.includes('INT')) return 'integer';
  if (upper.includes('REAL') || upper.includes('FLOAT') || upper.includes('NUMERIC')) return 'number';
  if (upper.includes('BOOL')) return 'boolean';
  return 'string';
}

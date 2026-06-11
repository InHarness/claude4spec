import { describe, expect, it } from 'vitest';
import { autoDerivedSchema } from './auto-schema.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

function stubHost(tableByType: Record<string, string>): ProjectPluginHost {
  return {
    getAvailable: (type: string) =>
      tableByType[type] ? ({ table: tableByType[type] } as ReturnType<ProjectPluginHost['getAvailable']>) : null,
  } as unknown as ProjectPluginHost;
}

describe('autoDerivedSchema', () => {
  it('skips audit columns, derives required from notnull and appends a tags array', () => {
    const db = createTestDb();
    const schema = autoDerivedSchema(db, 'endpoint', stubHost({ endpoint: 'endpoint' }));
    const properties = schema.properties as Record<string, { type: string }>;
    expect(schema._auto).toBe(true);
    expect(properties.id).toBeUndefined();
    expect(properties.created_at).toBeUndefined();
    expect(properties.updated_at).toBeUndefined();
    expect(properties.tags).toEqual({ type: 'array', items: { type: 'string' } });
    const required = schema.required as string[];
    // slug is TEXT PRIMARY KEY without an explicit NOT NULL, so PRAGMA
    // reports notnull=0 and it stays out of required
    expect(required).not.toContain('slug');
    expect(required).toEqual(expect.arrayContaining(['method', 'path', 'summary']));
    db.close();
  });

  it('maps JSON hint columns to array-of-object schemas', () => {
    const db = createTestDb();
    const schema = autoDerivedSchema(db, 'dto', stubHost({ dto: 'dto' }));
    const properties = schema.properties as Record<string, unknown>;
    expect(properties.fields).toEqual({ type: 'array', items: { type: 'object' } });
    db.close();
  });

  it('returns a _note for an unmapped type and resolves non-entity tables like section', () => {
    const db = createTestDb();
    const unknown = autoDerivedSchema(db, 'ghost', stubHost({}));
    expect(unknown._note).toMatch(/no table mapping/);

    const section = autoDerivedSchema(db, 'section', stubHost({}));
    expect(section._note).toBeUndefined();
    expect(section.properties).toBeDefined();
    db.close();
  });

  it('maps SQL column types to JSON types (INTEGER→integer, TEXT→string)', () => {
    const db = createTestDb();
    db.exec(`CREATE TABLE typed_probe (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL,
      score REAL,
      count INTEGER
    )`);
    const schema = autoDerivedSchema(db, 'probe', stubHost({ probe: 'typed_probe' }));
    const properties = schema.properties as Record<string, { type: string }>;
    expect(properties.label?.type).toBe('string');
    expect(properties.score?.type).toBe('number');
    expect(properties.count?.type).toBe('integer');
    db.close();
  });
});

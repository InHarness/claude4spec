import { describe, expect, it } from 'vitest';
import { autoDerivedSchema } from './auto-schema.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

/**
 * 2.0.0: a module no longer carries a `table` slot — the table name is derived
 * from the type slug — so the stub declares the TYPE and lets `compositionOf`
 * answer, exactly as the real host does.
 */
function stubHost(types: string[]): ProjectPluginHost {
  const known = new Set(types);
  return {
    getAvailable: (type: string) =>
      known.has(type) ? ({ type } as ReturnType<ProjectPluginHost['getAvailable']>) : null,
  } as unknown as ProjectPluginHost;
}

describe('autoDerivedSchema', () => {
  it('skips audit columns, derives required from notnull and appends a tags array', () => {
    // 0.2.2: exercised on `ui_view` rather than `endpoint` — the latter moved
    // into a builtin envelope, whose schema only exists once the (async) loader
    // has run, and this suite builds its database synchronously. The shape under
    // test is generic, so any entity table proves it.
    const db = createTestDb();
    const schema = autoDerivedSchema(db, 'ui-view', stubHost(['ui-view']));
    const properties = schema.properties as Record<string, { type: string }>;
    expect(schema._auto).toBe(true);
    expect(properties.id).toBeUndefined();
    expect(properties.created_at).toBeUndefined();
    expect(properties.updated_at).toBeUndefined();
    expect(properties.tags).toEqual({ type: 'array', items: { type: 'string' } });
    const required = schema.required as string[];
    // 2.0.0: the generator writes `slug TEXT NOT NULL PRIMARY KEY`, closing the
    // SQLite quirk where a TEXT primary key still accepts NULL. PRAGMA now
    // reports notnull=1, so the derived schema correctly calls slug required —
    // where before it silently did not.
    expect(required).toContain('slug');
    expect(required).toEqual(expect.arrayContaining(['name']));
    db.close();
  });

  it('maps JSON hint columns to array-of-object schemas', () => {
    // `fields` is one of the hinted column names; the table it sits on is
    // irrelevant to what this asserts, so a local probe keeps the case free of
    // whichever entity happens to own a `fields` column this release.
    const db = createTestDb();
    // 2.0.0: the table IS the type slug, so the probe table is named for it.
    db.exec(`CREATE TABLE hinted_probe (slug TEXT PRIMARY KEY, fields TEXT NOT NULL DEFAULT '[]')`);
    const schema = autoDerivedSchema(db, 'hinted-probe', stubHost(['hinted-probe']));
    const properties = schema.properties as Record<string, unknown>;
    expect(properties.fields).toEqual({ type: 'array', items: { type: 'object' } });
    db.close();
  });

  it('returns a _note for an unmapped type and resolves non-entity tables like section', () => {
    const db = createTestDb();
    const unknown = autoDerivedSchema(db, 'ghost', stubHost([]));
    expect(unknown._note).toMatch(/no table mapping/);

    const section = autoDerivedSchema(db, 'section', stubHost([]));
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
    const schema = autoDerivedSchema(db, 'typed-probe', stubHost(['typed-probe']));
    const properties = schema.properties as Record<string, { type: string }>;
    expect(properties.label?.type).toBe('string');
    expect(properties.score?.type).toBe('number');
    expect(properties.count?.type).toBe('integer');
    db.close();
  });
});

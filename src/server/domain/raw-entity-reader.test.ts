/**
 * 0.2.2 — `RawEntityReader` must not assume the seven core types.
 *
 * `ReleaseService.restoreSpec` now iterates EVERY active module rather than four
 * hardcoded core types, so a plugin-contributed type reaches `listSlugs`. That
 * method indexed the static `ENTITY_TABLES` map directly, so an unknown type
 * produced `SELECT slug FROM undefined` — a SqliteError thrown OUTSIDE
 * restoreSpec's per-slug try/catch, aborting the whole restore half-applied.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RawEntityReader } from './raw-entity-reader.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

let db: Database.Database;

function host(modules: Array<{ type: string; table: string }>): ProjectPluginHost {
  return {
    getEntity: (t: string) => modules.find((m) => m.type === t) ?? null,
  } as unknown as ProjectPluginHost;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE endpoint (slug TEXT PRIMARY KEY);
    CREATE TABLE use_cases (slug TEXT PRIMARY KEY);
    INSERT INTO endpoint (slug) VALUES ('e1');
    INSERT INTO use_cases (slug) VALUES ('uc-1'), ('uc-2');
  `);
});
afterEach(() => db.close());

describe('listSlugs', () => {
  it('still resolves the core types from the static map', () => {
    const reader = new RawEntityReader(db);
    expect(reader.listSlugs('endpoint')).toEqual(['e1']);
  });

  it('resolves a PLUGIN type through the host manifest instead of throwing', () => {
    const reader = new RawEntityReader(db, host([{ type: 'use-case', table: 'use_cases' }]));
    expect(reader.listSlugs('use-case' as never)).toEqual(['uc-1', 'uc-2']);
  });

  it('returns [] for an unresolvable type rather than SELECT FROM undefined', () => {
    // The crash this replaces was thrown outside restoreSpec's try/catch, so it
    // aborted the entire restore with the spec left half-applied.
    const reader = new RawEntityReader(db, host([]));
    expect(() => reader.listSlugs('ghost' as never)).not.toThrow();
    expect(reader.listSlugs('ghost' as never)).toEqual([]);
  });

  it('returns [] with no host at all (CLI readers construct one without)', () => {
    const reader = new RawEntityReader(db);
    expect(reader.listSlugs('use-case' as never)).toEqual([]);
  });
});

describe('count', () => {
  it('resolves a plugin type, and reports 0 for an unresolvable one', () => {
    const reader = new RawEntityReader(db, host([{ type: 'use-case', table: 'use_cases' }]));
    expect(reader.count('use-case' as never)).toBe(2);
    expect(reader.count('ghost' as never)).toBe(0);
  });
});

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
    // M39: `listTypes()` stopped being a frozen list of the seven core types and
    // now asks the host, so a fixture host has to answer this too.
    listEntities: () => modules,
  } as unknown as ProjectPluginHost;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE endpoint (slug TEXT PRIMARY KEY);
    CREATE TABLE use_case (slug TEXT PRIMARY KEY);
    INSERT INTO endpoint (slug) VALUES ('e1');
    INSERT INTO use_case (slug) VALUES ('uc-1'), ('uc-2');
  `);
});
afterEach(() => db.close());

describe('listSlugs', () => {
  it('still resolves the core types from the static map', () => {
    const reader = new RawEntityReader(db);
    expect(reader.listSlugs('endpoint')).toEqual(['e1']);
  });

  it('resolves a PLUGIN type through the host manifest instead of throwing', () => {
    const reader = new RawEntityReader(db, host([{ type: 'use-case' }]));
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
    const reader = new RawEntityReader(db, host([{ type: 'use-case' }]));
    expect(reader.count('use-case' as never)).toBe(2);
    expect(reader.count('ghost' as never)).toBe(0);
  });
});

/**
 * A NAME in the static map is not a table.
 *
 * Before 0.2.2 it may as well have been: the host's own migration chain created
 * all seven core tables unconditionally. Now each entity table is created by the
 * module that owns it, and `endpoint`/`dto` come from a builtin envelope the
 * host loads fail-soft — a missing `dist/plugins/…` bundle leaves the type with
 * no module and no table while `ENTITY_TABLES` still answers with a name.
 *
 * The design says such a type is simply ABSENT. Every read has to agree on that,
 * not just the one that was patched after a browser found it: `count` returned 0
 * while `listSlugs`, `getEntity` and `findByTag` all threw `no such table`,
 * which turned any page carrying a mixed `<tagged_list>` into a 500 and broke
 * the `find_by_tag` MCP tool.
 *
 * `dto` is the probe here precisely because it IS in the static map — the
 * fixture database just has no such table, which is exactly the shipped failure.
 */
describe('a core type whose table was never created', () => {
  const missing = 'dto' as never;

  it('reports no table rather than a name', () => {
    expect(new RawEntityReader(db).hasTable(missing)).toBe(false);
  });

  it('reads as absent everywhere, not as an error', () => {
    const reader = new RawEntityReader(db, host([]));
    expect(reader.listSlugs(missing)).toEqual([]);
    expect(reader.getEntity(missing, 'anything')).toBeNull();
    expect(reader.count(missing)).toBe(0);
  });

  it('does not abort a mixed find_by_tag over every type', () => {
    // The real caller: `<tagged_list>` with no `type` attribute walks ALL types,
    // so one absent type used to take the whole page down with it.
    db.exec(`
      CREATE TABLE tag (slug TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE entity_tag (entity_type TEXT, entity_slug TEXT, tag_slug TEXT);
      INSERT INTO tag VALUES ('core', 'Core');
      INSERT INTO entity_tag VALUES ('endpoint', 'e1', 'core');
    `);
    // `dto` is active for the host and absent from the database — the shipped
    // failure. The sweep must skip it and still return the endpoint's hit.
    const reader = new RawEntityReader(
      db,
      host([
        { type: 'endpoint', table: 'endpoint' },
        { type: 'dto', table: 'dto' },
      ]),
    );
    const hits = reader.findByTag({ tags: ['core'], filter: 'or' });
    expect(hits.map((h) => h.slug)).toEqual(['e1']);
  });
});

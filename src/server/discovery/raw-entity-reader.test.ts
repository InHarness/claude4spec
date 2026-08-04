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

// 2.0.0: a module no longer carries a `table` slot — `compositionOf` derives the
// table name from the type slug, so the fixture declares the type and nothing else.
function host(modules: Array<{ type: string }>): ProjectPluginHost {
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
        { type: 'endpoint' },
        { type: 'dto' },
      ]),
    );
    const hits = reader.findByTag({ tags: ['core'], filter: 'or' });
    expect(hits.map((h) => h.slug)).toEqual(['e1']);
  });
});

/**
 * The property an earlier revision of this change CLAIMED but did not hold.
 *
 * `count()` used to take the predicate as a PARAMETER, and only one of its two
 * callers passed it — so the agent's `<project>` block filtered while the
 * sidebar's `/entities/counts` did not, under a docblock asserting the two could
 * no longer diverge. Resolving the predicate inside `count()` is what makes the
 * claim structural: there is no argument to forget.
 */
describe('RawEntityReader.count — the declared predicate, resolved internally', () => {
  function hostWith(countPredicate?: { field: string; in?: string[]; eq?: string }) {
    const module = {
      type: 'ac',
      data: {
        schema: {
          text: { kind: 'string', required: true },
          status: { kind: 'enum', values: ['active', 'deprecated'], default: 'active' },
          caption: { kind: 'string', transientInput: true },
        },
      },
      systemPrompt: { roleNoun: 'ac', ...(countPredicate ? { countPredicate } : {}) },
    } as unknown as ReturnType<ProjectPluginHost['getEntity']>;
    return {
      getEntity: () => module,
      getAvailable: () => module,
      listEntities: () => [module],
      isActive: () => true,
    } as unknown as ProjectPluginHost;
  }

  function seeded(): Database.Database {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE ac (slug TEXT PRIMARY KEY, text TEXT, status TEXT);`);
    const insert = db.prepare('INSERT INTO ac (slug, text, status) VALUES (?, ?, ?)');
    for (let i = 0; i < 9; i += 1) insert.run(`a${i}`, 't', 'active');
    for (let i = 0; i < 3; i += 1) insert.run(`d${i}`, 't', 'deprecated');
    return db;
  }

  it('applies the type\'s declared predicate without being asked', () => {
    const reader = new RawEntityReader(seeded(), hostWith({ field: 'status', in: ['active'] }));
    expect(reader.count('ac')).toBe(9);
  });

  it('counts everything when the type declares no predicate', () => {
    expect(new RawEntityReader(seeded(), hostWith()).count('ac')).toBe(12);
  });

  it('degrades to an unfiltered count rather than throwing on a non-projected field', () => {
    // `caption` is `transientInput` — in the schema, never a column. Registration
    // rejects this shape; a hand-built module never goes through registration, and
    // a count must not be the thing that 500s the sidebar.
    const reader = new RawEntityReader(seeded(), hostWith({ field: 'caption', eq: 'x' }));
    expect(() => reader.count('ac')).not.toThrow();
    expect(reader.count('ac')).toBe(12);
  });
});

/**
 * Hydration decodes by DECLARATION, not by what the value looks like.
 *
 * The rule it replaces was a probe: any string column starting with `[` or `{`
 * went through `JSON.parse`. That is a guess about content, and D2 is a syntax
 * whose blocks open with `{`. The parse succeeded, so `diagram.source` came out
 * of the reader as an OBJECT — invisible until 0.2.9, because diagram's
 * hand-written serializer re-stringified it on the way back out.
 *
 * The generated snapshot has no such per-type rescue. Without the declaration
 * driving the decode, the parsed object is what gets written into the entity
 * file, and the diagram source is destroyed at its own source of truth.
 */
describe('hydrate — decoding is driven by the declared kind', () => {
  function diagramHost() {
    const module = {
      type: 'diagram',
      data: {
        schema: {
          format: { kind: 'enum', values: ['mermaid', 'd2'], default: 'mermaid' },
          source: { kind: 'string', required: true },
          params: { kind: 'collection', collection: 'value', item: { kind: 'string' } },
        },
      },
    } as unknown as ReturnType<ProjectPluginHost['getEntity']>;
    return {
      getEntity: () => module,
      getAvailable: () => module,
      listEntities: () => [module],
      isActive: () => true,
    } as unknown as ProjectPluginHost;
  }

  function seeded(source: string): Database.Database {
    const d = new Database(':memory:');
    d.exec(`
      CREATE TABLE diagram (slug TEXT PRIMARY KEY, format TEXT, source TEXT, params TEXT);
      CREATE TABLE tag (slug TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE entity_tag (entity_type TEXT, entity_slug TEXT, tag_slug TEXT);
    `);
    d.prepare('INSERT INTO diagram (slug, format, source, params) VALUES (?, ?, ?, ?)').run(
      'flow',
      'd2',
      source,
      '["a","b"]',
    );
    return d;
  }

  it('keeps a D2 source that opens with a brace as the string it is', () => {
    // Valid D2, and valid JSON. The probe parsed it; the declaration does not.
    const source = '{"a": {"shape": "circle"}}';
    const reader = new RawEntityReader(seeded(source), diagramHost());
    expect(reader.getEntity('diagram', 'flow')?.data.source).toBe(source);
  });

  it('still decodes a column the schema declares as a collection', () => {
    const reader = new RawEntityReader(seeded('x -> y'), diagramHost());
    expect(reader.getEntity('diagram', 'flow')?.data.params).toEqual(['a', 'b']);
  });

  it('falls back to the probe for a type that declares no schema', () => {
    // A type mid-migration must not silently stop decoding its JSON columns —
    // that failure is type-wide, where the one above is value-shaped.
    const noSchema = { getEntity: () => ({ type: 'diagram' }) } as unknown as ProjectPluginHost;
    const reader = new RawEntityReader(seeded('x -> y'), noSchema);
    expect(reader.getEntity('diagram', 'flow')?.data.params).toEqual(['a', 'b']);
  });
});

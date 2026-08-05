/**
 * 0.2.2 — the indexer stopped hardcoding table names and type lists, and these
 * tests pin the edges that regressed when it did.
 *
 * All three come from the same shift: the old code cleared a fixed set of SEVEN
 * known tables unconditionally, so "the table exists", "the name is safe to
 * interpolate" and "inactive types still get cleared" were true by construction.
 * Reading `module.table` from a plugin manifest makes none of them free.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityIndexerService } from './entity-indexer.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { EntityStore, TagSnapshot } from './entity-store.js';
import type { TagsService } from './tags.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { SelfWriteSuppressor } from '../fs/sources.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';

let db: Database.Database;
let warn: ReturnType<typeof vi.spyOn>;

type Mod = { type: string; table: string; displayOrder?: number; auxTables?: string[] };

/** Host double: `available` is the whole pool, `active` the config.entities subset. */
function hostWith(available: Mod[], activeTypes?: string[]): PluginHost {
  const isActive = (t: string) => (activeTypes ? activeTypes.includes(t) : true);
  const norm = available.map(({ auxTables, ...m }) => ({
    displayOrder: 10,
    ...m,
    backend: auxTables ? { auxTables } : undefined,
  }));
  return {
    listAvailable: () => norm,
    listEntities: () => norm.filter((m) => isActive(m.type)),
    getAvailable: (t: string) => norm.find((m) => m.type === t) ?? null,
    getEntity: (t: string) => (isActive(t) ? (norm.find((m) => m.type === t) ?? null) : null),
    restore: () => ({ op: 'created', entity: {} }),
  } as unknown as PluginHost;
}

function makeIndexer(host: PluginHost, store: Partial<EntityStore> = {}) {
  const fullStore = {
    root: '/tmp/entities',
    listType: () => [],
    isTagsFile: () => false,
    parseRelPath: () => null,
    read: () => ({}),
    ...store,
  } as unknown as EntityStore;
  const ws = { broadcast: vi.fn() } as unknown as WsEmitter;
  const indexer = new EntityIndexerService(
    db,
    fullStore,
    { suppress: () => {} } as SelfWriteSuppressor,
    ws,
    host,
    { assignTags: vi.fn(), listAll: () => [] } as unknown as TagsService,
    {} as RawEntityReader,
  );
  return { indexer, ws };
}

beforeEach(() => {
  db = new Database(':memory:');
  /**
   * 0.2.7 — `entity_tag.tag_slug` carries the REAL FK here, cascade and all, and
   * `foreign_keys` is ON. The double used to declare three bare TEXT columns, so
   * the cascade that wiped every assignment in the project when the rebuild
   * emptied `tag` could not reproduce in this file at all: the clearing tests
   * passed while the bug shipped.
   */
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE tag (slug TEXT PRIMARY KEY, name TEXT, color TEXT, description TEXT);
    CREATE TABLE entity_tag (
      entity_type TEXT NOT NULL,
      entity_slug TEXT NOT NULL,
      tag_slug    TEXT NOT NULL REFERENCES tag(slug) ON DELETE CASCADE ON UPDATE CASCADE,
      PRIMARY KEY (entity_type, entity_slug, tag_slug)
    );
    CREATE TABLE endpoint_dto (endpoint_slug TEXT, dto_slug TEXT);
    CREATE TABLE endpoint (slug TEXT PRIMARY KEY);
    CREATE TABLE diagram (slug TEXT PRIMARY KEY);
  `);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  db.close();
});

const rowCount = (t: string) =>
  (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;

describe('indexAll — clearing', () => {
  it('clears a DEACTIVATED type’s table, not just the active ones', async () => {
    // Pre-0.2.2 all seven tables were wiped unconditionally. Switching to
    // active-only left rows nothing would ever re-index or remove. (0.2.7: the
    // ENTITY rows of a deactivated type are still cleared here; what changed is
    // that its `entity_tag` rows are not — see the tag-registry block below.)
    db.prepare(`INSERT INTO diagram (slug) VALUES ('ghost')`).run();
    db.prepare(`INSERT INTO endpoint (slug) VALUES ('e1')`).run();

    const host = hostWith(
      [
        { type: 'endpoint', table: 'endpoint' },
        { type: 'diagram', table: 'diagram' },
      ],
      ['endpoint'], // diagram deactivated
    );
    await makeIndexer(host).indexer.indexAll();

    expect(rowCount('diagram')).toBe(0);
    expect(rowCount('endpoint')).toBe(0);
  });

  it('skips a declared table that no migration created, instead of aborting the rebuild', async () => {
    // The DELETE used to throw, rolling back the WHOLE transaction; the boot
    // catch swallowed it, leaving every entity served from a stale index.
    db.prepare(`INSERT INTO endpoint (slug) VALUES ('e1')`).run();
    const host = hostWith([
      { type: 'endpoint', table: 'endpoint' },
      { type: 'use-case' }, // no such table
    ]);

    await expect(makeIndexer(host).indexer.indexAll()).resolves.toBeUndefined();
    expect(rowCount('endpoint')).toBe(0); // the rest of the rebuild still ran
    expect(warn.mock.calls.flat().join(' ')).toContain('use_case');
  });

  it('clears a module-declared auxiliary table', async () => {
    // The junction used to be a hardcoded `DELETE FROM endpoint_dto` in the
    // indexer. The host now knows only that a module declared a table it owns.
    db.prepare(`INSERT INTO endpoint (slug) VALUES ('e1')`).run();
    db.prepare(`INSERT INTO endpoint_dto (endpoint_slug, dto_slug) VALUES ('e1', 'd1')`).run();

    const host = hostWith([{ type: 'endpoint', table: 'endpoint', auxTables: ['endpoint_dto'] }]);
    await makeIndexer(host).indexer.indexAll();

    expect(rowCount('endpoint_dto')).toBe(0);
  });

  it('clears a DEACTIVATED type’s auxiliary table too', async () => {
    // Same reasoning as the entity table above: a deactivated type's junction
    // rows are exactly as stale, and nothing else would ever remove them.
    db.prepare(`INSERT INTO endpoint_dto (endpoint_slug, dto_slug) VALUES ('e1', 'd1')`).run();
    const host = hostWith(
      [
        { type: 'endpoint', table: 'endpoint', auxTables: ['endpoint_dto'] },
        { type: 'diagram', table: 'diagram' },
      ],
      ['diagram'],
    );
    await makeIndexer(host).indexer.indexAll();

    expect(rowCount('endpoint_dto')).toBe(0);
  });

  it('skips a declared auxiliary table that does not exist', async () => {
    // A plugin can declare an aux table whose migration never ran. Throwing here
    // would roll back the whole rebuild, exactly as it did for entity tables.
    db.prepare(`INSERT INTO endpoint (slug) VALUES ('e1')`).run();
    const host = hostWith([{ type: 'endpoint', table: 'endpoint', auxTables: ['no_such_junction'] }]);

    await expect(makeIndexer(host).indexer.indexAll()).resolves.toBeUndefined();
    expect(rowCount('endpoint')).toBe(0);
  });

  it('refuses an auxiliary table name that is not a bare SQL identifier', async () => {
    db.prepare(`INSERT INTO endpoint (slug) VALUES ('e1')`).run();
    const host = hostWith([
      { type: 'endpoint', table: 'endpoint', auxTables: ['y; DROP TABLE endpoint; --'] },
    ]);

    await makeIndexer(host).indexer.indexAll();

    expect(() => rowCount('endpoint')).not.toThrow();
  });

  it('refuses a table name that is not a bare SQL identifier', async () => {
    // `db.exec` runs multi-statement SQL, so an unvalidated manifest string could
    // execute arbitrary DDL — impossible while the name came from a constant map.
    db.prepare(`INSERT INTO endpoint (slug) VALUES ('e1')`).run();
    const host = hostWith([
      { type: 'endpoint', table: 'endpoint' },
      { type: 'x; DROP TABLE endpoint; --' },
    ]);

    await makeIndexer(host).indexer.indexAll();

    // The table survives: the injected statement never ran.
    expect(() => rowCount('endpoint')).not.toThrow();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/unusable table name/);
  });
});

/**
 * 0.2.7 — the rebuild's scope rule is a property of the WHOLE TRANSACTION, not
 * of one statement: when `indexAll()` closes, no row whose type lies outside the
 * rebuild may be missing — whether an explicit DELETE or an FK cascade would
 * have taken it. Every assertion here therefore reads the state after the
 * transaction, never a single statement's effect.
 */
describe('indexAll — the tag registry and its assignments', () => {
  const TAGS: TagSnapshot[] = [
    { slug: 'auth', name: 'Auth', color: null, description: null },
    { slug: 'legacy', name: 'Legacy', color: null, description: null },
  ];
  /** Store double whose `tags.json` lists TAGS unless a test overrides it. */
  const storeWithTags = (tags: TagSnapshot[] = TAGS, exists = true): Partial<EntityStore> => ({
    readTags: () => tags,
    tagsFileExists: () => exists,
  });

  const seedTags = (slugs: string[]) => {
    const ins = db.prepare(`INSERT INTO tag (slug, name) VALUES (?, ?)`);
    for (const s of slugs) ins.run(s, s);
  };
  const assign = (type: string, slug: string, tag: string) =>
    db.prepare(`INSERT INTO entity_tag (entity_type, entity_slug, tag_slug) VALUES (?, ?, ?)`).run(type, slug, tag);
  const assignments = () =>
    db
      .prepare(`SELECT entity_type, entity_slug, tag_slug FROM entity_tag ORDER BY entity_type, entity_slug`)
      .all() as Array<{ entity_type: string; entity_slug: string; tag_slug: string }>;

  it('keeps the assignments of a type OUTSIDE the rebuild', async () => {
    // The unscoped `DELETE FROM entity_tag` took these, and nothing put them
    // back: a deactivated type came back from reactivation with its tags gone.
    seedTags(['auth', 'legacy']);
    assign('diagram', 'ghost', 'legacy'); // diagram is deactivated below
    assign('endpoint', 'e1', 'auth'); // in scope — the rebuild owns this one

    const host = hostWith(
      [
        { type: 'endpoint', table: 'endpoint' },
        { type: 'diagram', table: 'diagram' },
      ],
      ['endpoint'],
    );
    await makeIndexer(host, storeWithTags()).indexer.indexAll();

    expect(assignments()).toEqual([{ entity_type: 'diagram', entity_slug: 'ghost', tag_slug: 'legacy' }]);
  });

  it('does not let the tag registry cascade the assignments away', async () => {
    // The real bug: `DELETE FROM tag` ran a few statements after the scoped
    // delete and the FK cascade swept everything — including rows the scoped
    // delete had deliberately spared. Both tags are still in `tags.json`, so
    // nothing here justifies losing a single assignment.
    seedTags(['auth', 'legacy']);
    assign('diagram', 'ghost', 'auth');
    assign('diagram', 'ghost', 'legacy');

    const host = hostWith([{ type: 'endpoint', table: 'endpoint' }, { type: 'diagram', table: 'diagram' }], [
      'endpoint',
    ]);
    await makeIndexer(host, storeWithTags()).indexer.indexAll();

    expect(assignments()).toHaveLength(2);
    expect(rowCount('tag')).toBe(2);
  });

  it('reconciles the registry: a slug gone from tags.json is deleted, and only then does it cascade', async () => {
    // The cascade is not forbidden — it is scoped to tags that genuinely left
    // the file. That is the whole difference between reconciling and emptying.
    seedTags(['auth', 'legacy', 'stale']);
    assign('diagram', 'ghost', 'stale');
    assign('diagram', 'ghost', 'auth');

    const host = hostWith([{ type: 'endpoint', table: 'endpoint' }]);
    await makeIndexer(host, storeWithTags()).indexer.indexAll(); // tags.json has no 'stale'

    expect(db.prepare(`SELECT slug FROM tag ORDER BY slug`).all()).toEqual([
      { slug: 'auth' },
      { slug: 'legacy' },
    ]);
    expect(assignments()).toEqual([{ entity_type: 'diagram', entity_slug: 'ghost', tag_slug: 'auth' }]);
  });

  it('does not reconcile against a tags.json that is not there', async () => {
    // `readTags()` answers `[]` for an absent file as readily as for an empty
    // one. Treating the two alike would empty the registry — and cascade every
    // assignment — on a project that has not exported its tags to text yet.
    seedTags(['auth']);
    assign('diagram', 'ghost', 'auth');

    const host = hostWith([{ type: 'endpoint', table: 'endpoint' }]);
    await makeIndexer(host, storeWithTags([], false)).indexer.indexAll();

    expect(rowCount('tag')).toBe(1);
    expect(assignments()).toHaveLength(1);
  });
});

describe('handleUnlink', () => {
  const store = {
    isTagsFile: () => false,
    parseRelPath: () => ({ type: 'diagram' as never, slug: 'gone' }),
  };

  it('deletes the row for a file whose type is DEACTIVATED', async () => {
    // Gating on active-only left the row behind while still broadcasting a
    // delete — and the rebuild no longer clears inactive tables either, so
    // nothing would ever remove it.
    db.prepare(`INSERT INTO diagram (slug) VALUES ('gone')`).run();
    const host = hostWith([{ type: 'diagram', table: 'diagram' }], []); // inactive
    const { indexer, ws } = makeIndexer(host, store);

    await indexer.handleUnlink('diagrams/gone.json');

    expect(rowCount('diagram')).toBe(0);
    expect(ws.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'entity:indexed', op: 'delete' }),
    );
  });

  it('does NOT broadcast a delete it could not perform', async () => {
    const host = hostWith([], []); // type resolves to no module at all
    const { indexer, ws } = makeIndexer(host, store);

    await indexer.handleUnlink('diagrams/gone.json');

    expect(ws.broadcast).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/could not be removed/);
  });
});

describe('indexAll — counting', () => {
  it('does not count a restore that reported a noop skip', async () => {
    // `restore` no longer throws when a type has no entity service; it returns
    // `{op:'noop', entity:null}`. Counting that as indexed reported
    // "indexed N entities" with zero warnings while the table stayed empty.
    const host = {
      ...hostWith([{ type: 'endpoint', table: 'endpoint' }]),
      restore: () => ({ op: 'noop', entity: null, warnings: ['no entity service'] }),
    } as unknown as PluginHost;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await makeIndexer(host, { listType: () => ['e1', 'e2'] }).indexer.indexAll();

    expect(log.mock.calls.flat().join(' ')).toContain('indexed 0 entities');
    expect(warn.mock.calls.flat().join(' ')).toContain('no entity service');
    log.mockRestore();
  });
});

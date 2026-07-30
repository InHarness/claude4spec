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
import type { EntityStore } from './entity-store.js';
import type { TagsService } from './tags.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { EntitiesWatcher } from '../fs/entities-watcher.js';
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
    {} as EntitiesWatcher,
    ws,
    host,
    { assignTags: vi.fn(), listAll: () => [] } as unknown as TagsService,
    {} as RawEntityReader,
  );
  return { indexer, ws };
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE entity_tag (entity_type TEXT, entity_slug TEXT, tag_slug TEXT);
    CREATE TABLE tag (slug TEXT PRIMARY KEY, name TEXT);
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
    // active-only left rows nothing would ever re-index or remove — and since
    // entity_tag IS still wiped unconditionally, they became tag-less phantoms
    // visible to reference resolution and count stats.
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
      { type: 'use-case', table: 'use_cases' }, // no such table
    ]);

    await expect(makeIndexer(host).indexer.indexAll()).resolves.toBeUndefined();
    expect(rowCount('endpoint')).toBe(0); // the rest of the rebuild still ran
    expect(warn.mock.calls.flat().join(' ')).toContain('use_cases');
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
      { type: 'evil', table: 'x; DROP TABLE endpoint; --' },
    ]);

    await makeIndexer(host).indexer.indexAll();

    // The table survives: the injected statement never ran.
    expect(() => rowCount('endpoint')).not.toThrow();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/unusable table name/);
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

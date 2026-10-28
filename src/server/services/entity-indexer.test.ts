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
import { EntityIndexerService, INDEX_SLICE_FILES } from './entity-indexer.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { EntityStore, TagSnapshot } from './entity-store.js';
import type { TagsService } from './tags.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { SelfWriteSuppressor } from '../fs/sources.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import { PROJECTION_IDS, ProjectionStatusRegistry } from './projection-status.js';

let db: Database.Database;
let warn: ReturnType<typeof vi.spyOn>;

type Mod = { type: string; table: string; auxTables?: string[] };

/** Host double: `available` is the whole pool, `active` the config.entities subset. */
function hostWith(available: Mod[], activeTypes?: string[]): PluginHost {
  const isActive = (t: string) => (activeTypes ? activeTypes.includes(t) : true);
  const norm = available.map(({ auxTables, ...m }) => ({
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

function makeIndexer(host: PluginHost, store: Partial<EntityStore> = {}, projectionStatus?: ProjectionStatusRegistry) {
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
    projectionStatus,
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

  it('[ac:ac-rebuild-ktory-pominal-tabele-zadeklar] raises the per-type staleness flag AFTER the transaction closes for a skipped declared type', async () => {
    /**
     * A declared type whose table no migration ever created. Skipping it is
     * right — throwing would roll the WHOLE rebuild back and cost every other
     * type its index over one plugin's missing migration — but a skip that only
     * logged left this type's rows unrefilled while every read went on answering
     * from them. That is the same condition a failed `projection` phase produces,
     * so it sets the SAME flag: two roads, one state, one degradation rule.
     */
    db.prepare(`INSERT INTO endpoint (slug) VALUES ('e1')`).run();
    const host = hostWith([
      { type: 'endpoint', table: 'endpoint' },
      { type: 'ghost', table: 'ghost_never_migrated' },
    ]);
    const status = new ProjectionStatusRegistry();

    await expect(makeIndexer(host, {}, status).indexer.indexAll()).resolves.toBeUndefined();

    // Per TYPE, which is the vocabulary every read gates on — a marker spelled
    // as a table name would never match `listEntities({ type })`.
    expect(status.isStale(PROJECTION_IDS.entities, 'ghost')).toBe(true);
    // And NOT a rollback: the type that rebuilt cleanly is untouched and usable.
    expect(status.isStale(PROJECTION_IDS.entities, 'endpoint')).toBe(false);
    expect(status.snapshot().find((r) => r.id === PROJECTION_IDS.entities)?.scope).toEqual(['ghost']);
  });

  it('leaves the entity projection fresh when every declared table exists', async () => {
    db.prepare(`INSERT INTO endpoint (slug) VALUES ('e1')`).run();
    const status = new ProjectionStatusRegistry();
    const host = hostWith([{ type: 'endpoint', table: 'endpoint' }]);
    await makeIndexer(host, {}, status).indexer.indexAll();
    expect(status.isStale(PROJECTION_IDS.entities)).toBe(false);
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

/**
 * 2.1.60 (M29 `m29idx001`) — the rebuild reads its files in slices and hands the
 * event loop back between them: a context build runs in the background next to
 * projects that are already serving, and must not stall them for its whole length.
 */
describe('indexAll — reads in slices and yields the event loop', () => {
  const TOTAL = INDEX_SLICE_FILES * 2 + 5; // three slices
  const slugs = Array.from({ length: TOTAL }, (_, i) => `e-${String(i).padStart(4, '0')}`);

  /** A host whose `restore` records what it was handed, per slug, in call order. */
  function recordingHost() {
    const restored: Array<{ slug: string; snap: unknown }> = [];
    const host = {
      ...hostWith([{ type: 'endpoint', table: 'endpoint' }]),
      restore: (_type: string, snap: { slug: string }) => {
        restored.push({ slug: snap.slug, snap });
        return { op: 'created', entity: {} };
      },
    } as unknown as PluginHost;
    return { host, restored };
  }

  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());

  it('[section:m29idx001] other work on the event loop runs between the slices, before the rebuild resolves', async () => {
    let reads = 0;
    const { host, restored } = recordingHost();
    const { indexer } = makeIndexer(host, {
      listType: (type: string) => (type === 'endpoint' ? slugs : []),
      read: (_type: string, slug: string) => {
        reads += 1;
        return { slug } as never;
      },
    } as Partial<EntityStore>);

    // Stands in for a request to another project: queued on the loop the moment
    // the rebuild starts.
    let readsWhenOtherWorkRan = -1;
    setImmediate(() => {
      readsWhenOtherWorkRan = reads;
    });

    const rebuild = indexer.indexAll();
    // The call returned control after its first slice, not after every file.
    expect(reads).toBe(INDEX_SLICE_FILES);

    await rebuild;
    // The other work ran mid-rebuild: after the first slice, before the last.
    expect(readsWhenOtherWorkRan).toBeGreaterThanOrEqual(INDEX_SLICE_FILES);
    expect(readsWhenOtherWorkRan).toBeLessThan(TOTAL);
    // And the rebuild is still complete — every file read once, every entity restored.
    expect(reads).toBe(TOTAL);
    expect(restored.map((r) => r.slug)).toEqual(slugs);
    expect(log.mock.calls.flat().join(' ')).toContain(`indexed ${TOTAL} entities`);
  });

  it('[section:m29idx001] the database is written in one go after the reads — nothing is cleared while the rebuild is still yielding', async () => {
    db.prepare(`INSERT INTO endpoint (slug) VALUES ('kept-until-commit')`).run();
    const { host } = recordingHost();
    const { indexer } = makeIndexer(host, {
      listType: (type: string) => (type === 'endpoint' ? slugs : []),
      read: (_type: string, slug: string) => ({ slug }) as never,
    } as Partial<EntityStore>);

    let rowsMidRebuild = -1;
    setImmediate(() => {
      rowsMidRebuild = rowCount('endpoint');
    });
    await indexer.indexAll();

    // A reader of this connection between the slices still saw the old index,
    // never a half-cleared one; the commit then replaced it.
    expect(rowsMidRebuild).toBe(1);
    expect(rowCount('endpoint')).toBe(0); // the double's restore writes no rows
  });

  it('[section:m29idx001] a file changed or added between the slices is committed as it is on disk, not as it was read', async () => {
    const onDisk = new Map<string, { slug: string; title: string }>(
      slugs.map((slug) => [slug, { slug, title: 'v1' }]),
    );
    const { host, restored } = recordingHost();
    const { indexer } = makeIndexer(host, {
      listType: (type: string) => (type === 'endpoint' ? slugs : []),
      read: (_type: string, slug: string) => {
        const file = onDisk.get(slug);
        if (!file) throw new Error('ENOENT');
        return { ...file } as never;
      },
      exists: (_type: string, slug: string) => onDisk.has(slug),
      parseRelPath: (relPath: string) => ({ type: 'endpoint' as never, slug: relPath.slice('endpoint/'.length, -'.json'.length) }),
    } as Partial<EntityStore>);

    const rebuild = indexer.indexAll();
    // Between the slices: one already-read file is rewritten, one new file
    // appears, one already-read file is deleted — each announced by the watcher.
    const first = slugs[0]!;
    const gone = slugs[1]!;
    onDisk.set(first, { slug: first, title: 'v2' });
    onDisk.set('e-new', { slug: 'e-new', title: 'v1' });
    onDisk.delete(gone);
    indexer.onChange({} as never, 'entities', `endpoint/${first}.json`);
    indexer.onChange({} as never, 'entities', 'endpoint/e-new.json');
    void indexer.onUnlink({} as never, 'entities', `endpoint/${gone}.json`);
    await rebuild;

    // The rebuild's own restores are the last ones for each slug.
    const last = new Map<string, unknown>();
    for (const r of restored) last.set(r.slug, r.snap);
    expect(last.get(first)).toMatchObject({ title: 'v2' });
    expect(last.get('e-new')).toMatchObject({ title: 'v1' });
    // The deleted file is not restored by the commit (its only restore, if any,
    // came before the event).
    const restoresOfGone = restored.filter((r) => r.slug === gone).length;
    expect(restoresOfGone).toBe(0);
  });

  it('[carried:U2-rev-0002] [section:m29idx001] a second indexAll() while one is between its slices reuses the one in flight — the files are read once, nothing interleaves', async () => {
    let reads = 0;
    const { host, restored } = recordingHost();
    const { indexer } = makeIndexer(host, {
      listType: (type: string) => (type === 'endpoint' ? slugs : []),
      read: (_type: string, slug: string) => {
        reads += 1;
        return { slug } as never;
      },
    } as Partial<EntityStore>);

    const first = indexer.indexAll();
    const second = indexer.indexAll(); // e.g. the manual projection rebuild during the build's pass
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(reads).toBe(TOTAL);
    expect(restored.map((r) => r.slug)).toEqual(slugs);

    // Once it has settled, a new call is a new rebuild.
    await indexer.indexAll();
    expect(reads).toBe(TOTAL * 2);
  });

  it('[carried:U2-rev-0002] a rebuild whose context is released between its slices ends early — no commit through the closing handle', async () => {
    db.prepare(`INSERT INTO endpoint (slug) VALUES ('still-indexed')`).run();
    let reads = 0;
    const { host, restored } = recordingHost();
    const { indexer } = makeIndexer(host, {
      listType: (type: string) => (type === 'endpoint' ? slugs : []),
      read: (_type: string, slug: string) => {
        reads += 1;
        return { slug } as never;
      },
    } as Partial<EntityStore>);

    const rebuild = indexer.indexAll();
    expect(reads).toBe(INDEX_SLICE_FILES);
    // The context's dispose (or a failed build's cleanup) runs before the next slice.
    indexer.dispose();
    await expect(rebuild).resolves.toBeUndefined();
    // No further slice was read, nothing was cleared and nothing restored.
    expect(reads).toBe(INDEX_SLICE_FILES);
    expect(rowCount('endpoint')).toBe(1);
    expect(restored).toEqual([]);
  });
});

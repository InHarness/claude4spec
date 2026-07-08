import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { VersionService } from './versions.js';
import { DomainError } from './tags.js';
import { PluginRegistryImpl } from '../core/plugin-host/registry.js';
import { RawEntityReader } from '../domain/raw-entity-reader.js';
import type { BackendModule, MountContext, PluginHost } from '../core/plugin-host/types.js';
import type { EntityStore } from './entity-store.js';
import type { TagsService } from './tags.js';

describe('VersionService.restore', () => {
  let db: Database.Database;
  let versions: VersionService;
  let hostRestore: ReturnType<typeof vi.fn>;
  let storePersist: ReturnType<typeof vi.fn>;
  let storeRemove: ReturnType<typeof vi.fn>;
  let serviceRemove: ReturnType<typeof vi.fn>;
  let serviceGetBySlug: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    versions = new VersionService(db);

    hostRestore = vi.fn(() => ({ op: 'updated' as const, entity: null }));
    storePersist = vi.fn();
    storeRemove = vi.fn();
    serviceGetBySlug = vi.fn(() => ({ slug: 'my-dto' }));
    // Mirrors DtoService.remove(): captures its own 'delete' version before
    // deleting the row (see src/server/entities/dto/services.ts:236-256).
    serviceRemove = vi.fn((slug: string, actor: 'user' | 'agent') => {
      versions.captureEntitySnapshot('dto', slug, 'delete', actor, 'Deleted', '1.1.0');
    });

    // Fakes: VersionService.restore() only calls host.restore/getEntity and
    // entityStore.persist directly — the delegated plugin restore machinery
    // (HostEntityWriter → serializer.restore) is exercised elsewhere.
    const fakeHost = {
      restore: hostRestore,
      getEntity: () => ({ serializer: { version: '1.1.0' } }),
      getEntityService: () => ({ getBySlug: serviceGetBySlug, remove: serviceRemove }),
    } as unknown as PluginHost;
    const fakeEntityStore = { persist: storePersist, remove: storeRemove } as unknown as EntityStore;
    const fakeTagsService = {} as TagsService;

    // getEntity: null ⇒ captureEntitySnapshot's post-restore capture falls
    // back to the last-known version's data instead of re-reading a raw row
    // (fakeHost.restore above doesn't actually write one).
    const fakeReader = { getEntity: () => null } as never;
    versions.configureSnapshot(fakeReader, fakeHost);
    versions.configureRestore(fakeEntityStore, fakeTagsService);
  });

  it('throws NOT_FOUND for a version that was never captured', () => {
    expect(() => versions.restore('dto', 'my-dto', 1, 'user')).toThrow(DomainError);
    expect(() => versions.restore('dto', 'my-dto', 1, 'user')).toThrow(/not found/);
  });

  it('throws VALIDATION before boot deps are wired', () => {
    const bare = new VersionService(db);
    expect(() => bare.restore('dto', 'my-dto', 1, 'user')).toThrow(/unavailable before boot completes/);
  });

  it('restores to the target snapshot and captures a new update version', () => {
    versions.createVersion('dto', 'my-dto', { name: 'Foo' }, 'user', 'Created', 'create', '1.1.0');
    versions.createVersion('dto', 'my-dto', { name: 'Bar' }, 'user', 'Renamed', 'update', '1.1.0');

    const result = versions.restore('dto', 'my-dto', 1, 'user');

    expect(hostRestore).toHaveBeenCalledWith(
      'dto',
      { name: 'Foo' },
      expect.objectContaining({ releaseId: null, actor: 'user' }),
    );
    expect(storePersist).toHaveBeenCalledWith('dto', 'my-dto');
    expect(result.op).toBe('update');
    expect(result.changeSummary).toBe('Restored to version 1');
    expect(result.version).toBe(3);
  });

  it('restoring to a delete-tombstone version deletes instead of crashing on null data', () => {
    versions.createVersion('dto', 'my-dto', { name: 'Foo' }, 'user', 'Created', 'create', '1.1.0');
    versions.createVersion('dto', 'my-dto', null, 'user', 'Deleted', 'delete', '1.1.0');

    const result = versions.restore('dto', 'my-dto', 2, 'user');

    // Never hands null data to a serializer's restore() — routes through the
    // entity's own delete path instead (mirroring release.ts's delete branch).
    expect(hostRestore).not.toHaveBeenCalled();
    expect(serviceRemove).toHaveBeenCalledWith('my-dto', 'user');
    expect(storeRemove).toHaveBeenCalledWith('dto', 'my-dto');
    expect(storePersist).not.toHaveBeenCalled();
    expect(result.op).toBe('delete');
  });

  it('takes the delete path for a legacy row with null data but no stored op', () => {
    // Pre-M17 rows have no `op` column value at all — VersionDetail.op comes
    // back undefined (toDetail omits it when falsy), so the guard must not
    // rely on `op === 'delete'` alone; `data === null` must also trigger it.
    db.prepare(
      `INSERT INTO entity_version (entity_type, entity_slug, version, data, changed_by, op)
       VALUES ('dto', 'my-dto', 1, 'null', 'user', NULL)`,
    ).run();

    const result = versions.restore('dto', 'my-dto', 1, 'user');

    expect(hostRestore).not.toHaveBeenCalled();
    expect(serviceRemove).toHaveBeenCalledWith('my-dto', 'user');
    expect(result.op).toBe('delete');
  });
});

/**
 * M17: a minimal, real (non-core) plugin module — distinct from every
 * RawEntityType — with a real migrated table and a real serializer, so these
 * tests exercise the actual RawEntityReader → host.getEntity → entity_version
 * path, not a fake reader/host. Proves "any active type" isn't limited to the
 * 7 hardcoded core types.
 */
function fixtureModule(type: string, opts: { snapshotThrows?: boolean } = {}): BackendModule {
  return {
    type,
    table: type,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 999,
    slugFrom: (d: unknown) => String((d as { slug?: string }).slug ?? ''),
    pathPrefix: `/${type}s`,
    serializer: {
      type,
      version: '1.0.0',
      snapshot: (entity: unknown) => {
        if (opts.snapshotThrows) throw new Error('boom: no snapshot support');
        const e = entity as { slug: string; data: Record<string, unknown> };
        return { slug: e.slug, ...e.data };
      },
    } as BackendModule['serializer'],
    systemPrompt: {
      roleNoun: type,
      countStat: { placeholder: `${type}Count`, sqlQuery: 'SELECT 0 AS count', label: type },
      mcpToolsLine: `${type}-tools: ...`,
    },
    backend: {
      migrations: [
        { version: 1, name: `create_${type}`, up: `CREATE TABLE ${type} (slug TEXT PRIMARY KEY NOT NULL, name TEXT);` },
      ],
    },
  };
}

describe('VersionService.captureEntitySnapshot — generic plugin types (M17)', () => {
  function setupHost(type: string, opts: { snapshotThrows?: boolean } = {}) {
    const db = new Database(':memory:');
    runMigrations(db);
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(fixtureModule(type, opts));
    const host = registry.consolidate({ entities: [type] });
    host.mountBackend({ db } as unknown as MountContext);
    const reader = new RawEntityReader(db, host);
    const versions = new VersionService(db);
    versions.configureSnapshot(reader, host);
    return { db, versions };
  }

  it('captures an entity_version row for a type outside the core RawEntityType union', () => {
    const { db, versions } = setupHost('widget');
    db.prepare(`INSERT INTO widget (slug, name) VALUES ('my-widget', 'Hello')`).run();

    const result = versions.captureEntitySnapshot('widget', 'my-widget', 'create', 'user', 'Created', '1.0.0');

    expect(result.version).toBe(1);
    const row = db
      .prepare(
        `SELECT entity_type, entity_slug, data FROM entity_version WHERE entity_type = 'widget' AND entity_slug = 'my-widget'`,
      )
      .get() as { entity_type: string; entity_slug: string; data: string };
    expect(row.entity_type).toBe('widget');
    expect(JSON.parse(row.data)).toMatchObject({ slug: 'my-widget', name: 'Hello' });
  });

  it('lists a captured plugin-type version through the same generic path GET /versions uses', () => {
    const { db, versions } = setupHost('widget');
    db.prepare(`INSERT INTO widget (slug, name) VALUES ('my-widget', 'Hello')`).run();
    versions.captureEntitySnapshot('widget', 'my-widget', 'create', 'user', 'Created', '1.0.0');

    const list = versions.listVersions('widget', 'my-widget');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ version: 1, op: 'create' });
  });

  it('never silently swallows a capture failure — logs and rethrows, and no row is inserted', () => {
    const { db, versions } = setupHost('brokenwidget', { snapshotThrows: true });
    db.prepare(`INSERT INTO brokenwidget (slug, name) VALUES ('oops', 'X')`).run();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      versions.captureEntitySnapshot('brokenwidget', 'oops', 'create', 'user', 'Created', '1.0.0'),
    ).toThrow(/boom: no snapshot support/);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('snapshot capture failed for brokenwidget/oops'),
      expect.any(Error),
    );
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM entity_version WHERE entity_type = 'brokenwidget'`)
      .get() as { c: number };
    expect(row.c).toBe(0);

    errorSpy.mockRestore();
  });
});

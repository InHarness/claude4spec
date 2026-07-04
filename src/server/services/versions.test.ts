import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { VersionService } from './versions.js';
import { DomainError } from './tags.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { EntityStore } from './entity-store.js';
import type { TagsService } from './tags.js';

describe('VersionService.restore', () => {
  let db: Database.Database;
  let versions: VersionService;
  let hostRestore: ReturnType<typeof vi.fn>;
  let storePersist: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    versions = new VersionService(db);

    hostRestore = vi.fn(() => ({ op: 'updated' as const, entity: null }));
    storePersist = vi.fn();

    // Fakes: VersionService.restore() only calls host.restore/getEntity and
    // entityStore.persist directly — the delegated plugin restore machinery
    // (HostEntityWriter → serializer.restore) is exercised elsewhere.
    const fakeHost = {
      restore: hostRestore,
      getEntity: () => ({ serializer: { version: '1.1.0' } }),
    } as unknown as PluginHost;
    const fakeEntityStore = { persist: storePersist } as unknown as EntityStore;
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
});

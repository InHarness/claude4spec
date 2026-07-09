import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseFileStore } from './release-store.js';
import { ReleaseIndexerService } from './release-indexer.js';
import { ReleasesWatcher } from '../fs/releases-watcher.js';

interface SpecReleaseRow {
  id: number;
  name: string;
  slug: string | null;
  description: string;
  created_by: string;
  created_at: string;
}

describe('ReleaseIndexerService — upsert-by-slug id stability', () => {
  let dir: string;
  let db: Database.Database;
  let store: ReleaseFileStore;
  let indexer: ReleaseIndexerService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-release-idx-'));
    db = new Database(':memory:');
    runMigrations(db);
    const watcher = new ReleasesWatcher(path.join(dir, 'releases'));
    store = new ReleaseFileStore(dir, 'releases', watcher);
    store.ensureRoot();
    indexer = new ReleaseIndexerService(db, store, watcher);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const rows = (): SpecReleaseRow[] =>
    db.prepare('SELECT * FROM spec_release ORDER BY id').all() as SpecReleaseRow[];

  it('indexAll assigns a fresh id to a genuinely new release file', async () => {
    store.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First release',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    await indexer.indexAll();

    const all = rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.slug).toBe('v1');
    expect(all[0]!.name).toBe('v1');
  });

  it('a second indexAll rebuild preserves the same id for an unchanged release file (upsert, not delete-all)', async () => {
    store.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First release',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    await indexer.indexAll();
    const firstId = rows()[0]!.id;

    // Simulate a full rebuild (boot, or a `git pull` triggering re-indexAll).
    await indexer.indexAll();
    await indexer.indexAll();

    const after = rows();
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(firstId);
  });

  it('indexAll updates description on a changed file while keeping the id (rename/update path)', async () => {
    store.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First release',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    await indexer.indexAll();
    const firstId = rows()[0]!.id;

    store.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First release — updated',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    await indexer.indexAll();

    const after = rows();
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(firstId);
    expect(after[0]!.description).toBe('First release — updated');
  });

  it('does not touch a pre-existing release row with slug = NULL (legacy, no backing file)', async () => {
    db.prepare(
      `INSERT INTO spec_release (name, description, created_by) VALUES (?, ?, ?)`,
    ).run('legacy-release', 'Born before this feature', 'user');
    const legacyId = rows()[0]!.id;

    store.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First release',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    await indexer.indexAll();
    await indexer.indexAll();

    const all = rows();
    expect(all).toHaveLength(2);
    const legacy = all.find((r) => r.id === legacyId)!;
    expect(legacy.slug).toBeNull();
    expect(legacy.name).toBe('legacy-release');
  });

  it('handleUnlink removes the cache row for the deleted release file only', async () => {
    store.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    store.write('v2', {
      name: 'v2',
      slug: 'v2',
      description: 'Second',
      createdAt: '2026-01-02T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    await indexer.indexAll();
    expect(rows()).toHaveLength(2);

    await indexer.handleUnlink('v1.json');

    const after = rows();
    expect(after).toHaveLength(1);
    expect(after[0]!.slug).toBe('v2');
  });

  it('schedulePage debounces and upserts a single new file incrementally', async () => {
    store.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    indexer.schedulePage('v1.json');
    await new Promise((resolve) => setTimeout(resolve, 350));

    const all = rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.slug).toBe('v1');
  });
});

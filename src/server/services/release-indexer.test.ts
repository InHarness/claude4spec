import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseFileStore } from './release-store.js';
import { ReleaseIndexerService } from './release-indexer.js';
import type { SelfWriteSuppressor } from '../fs/sources.js';

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
    const watcher = { suppress: () => {} } as SelfWriteSuppressor;
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

  // ── 0.2.2 (brief §8): `roots` joins the reconstructable metadata ──────────
  //
  // Before migration 049 the column did not exist: `roots` lived in the JSON file
  // with nowhere to land, so a rebuilt DB lost each release's releasable-root set
  // and diffs silently fell back to the project's CURRENT roots.

  it('rebuilds roots from the release file (0.2.2 — migration 049)', async () => {
    store.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First release',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages', 'docs'],
    });
    await indexer.indexAll();
    expect(JSON.parse(rows()[0]!.roots as string)).toEqual(['pages', 'docs']);
  });

  it('updates roots on a changed file while keeping the id', async () => {
    const write = (roots: string[]) =>
      store.write('v1', {
        name: 'v1',
        slug: 'v1',
        description: 'First release',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'user',
        roots,
      });
    write(['pages']);
    await indexer.indexAll();
    const id = rows()[0]!.id;

    write(['pages', 'specs']);
    await indexer.indexAll();

    const after = rows();
    expect(after).toHaveLength(1);
    // The surrogate id is what entity_version.release_id points at — it must
    // survive a rebuild even as roots change.
    expect(after[0]!.id).toBe(id);
    expect(JSON.parse(after[0]!.roots as string)).toEqual(['pages', 'specs']);
  });

  it('stores NULL, not [], when the file records no roots', async () => {
    store.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First release',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      roots: undefined as unknown as string[],
    });
    await indexer.indexAll();
    // NULL means "not recorded — fall back to the current releasable roots",
    // which is a different statement from "this release covered zero roots".
    expect(rows()[0]!.roots).toBeNull();
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
      `INSERT INTO spec_release (name, description, created_by, created_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
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

  it('indexAll keeps release files named "current" and "initial" (2.1.23 — no name filter)', async () => {
    store.write('current', {
      name: 'current',
      slug: 'current',
      description: 'Kept, listed, unaddressable',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    store.write('initial', {
      name: 'initial',
      slug: 'initial',
      description: 'Also kept',
      createdAt: '2026-01-02T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    await indexer.indexAll();

    expect(rows().map((r) => r.slug).sort()).toEqual(['current', 'initial']);
  });

  it('an incremental upsert keeps a file reserved-named "current"', async () => {
    store.write('current', {
      name: 'current',
      slug: 'current',
      description: 'Synced after boot, via file-watch instead of a full rebuild',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    indexer.onChange('context:test', 'releases', 'current.json');
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(rows().map((r) => r.slug)).toEqual(['current']);
  });

  it('an incremental upsert adds a single new file without a full rebuild', async () => {
    store.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    indexer.onChange('context:test', 'releases', 'v1.json');
    await new Promise((resolve) => setTimeout(resolve, 350));

    const all = rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.slug).toBe('v1');
  });
  /**
   * 2.1.45 (M17 d8871ce9) — a release file and content changes pulled in by ONE
   * git merge, the pulled release becoming the newest on the axis: the indexer
   * adds the release to the axis and assigns it NO versions. The merged content
   * is committed, so git counts it in the pulled release's reign (counter 0),
   * while the cache keeps those captures as versions without a release.
   */
  it('[section:d8871ce9] a merged-in newest release file assigns no versions — captured content stays without a release', async () => {
    store.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'Local',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    await indexer.indexAll();
    // The merge's content changes, captured as versions without a release.
    db.prepare(
      `INSERT INTO entity_version (entity_type, entity_slug, version, data, changed_by, release_id, serializer_version, op)
       VALUES ('endpoint', 'e1', 1, '{"title":"merged"}', 'user', NULL, 'v1', 'create')`,
    ).run();
    db.prepare(
      `INSERT INTO file_version (path, version, data, serializer_version, op, release_id, changed_by, rootId)
       VALUES ('a.md', 1, '{"content":"merged"}', 'v1', 'create', NULL, 'user', 'pages')`,
    ).run();
    // The release file arriving with the same merge, newer on the axis.
    store.write('v2', {
      name: 'v2',
      slug: 'v2',
      description: 'Pulled by merge',
      createdAt: '2026-02-01T00:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
    });
    indexer.onChange('context:test', 'releases', 'v2.json');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await indexer.indexAll();

    const newest = db.prepare('SELECT slug FROM spec_release ORDER BY created_at DESC, id DESC LIMIT 1').get() as { slug: string };
    expect(newest.slug).toBe('v2');
    const assigned = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE release_id IS NOT NULL`).get() as { n: number }).n;
    expect(assigned('entity_version')).toBe(0);
    expect(assigned('file_version')).toBe(0);
  });
});

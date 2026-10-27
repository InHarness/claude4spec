import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { FileVersionService } from './file-version.js';
import { ReleaseFileStore } from './release-store.js';
import { DomainError } from './tags.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from './file-serializer.js';
import type { VersionService } from './versions.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';
import type { GitService } from './git.js';
import type { SelfWriteSuppressor } from '../fs/sources.js';

/**
 * M17 — `releaseService.createRelease({ name, description })`: validation of
 * the input, and ONE SQLite transaction carrying the `spec_release` INSERT, the
 * `entity_version` UPDATE and the `file_version` UPDATE (real `FileVersionService`
 * on the same database).
 */

const fakeHost = { getEntity: () => null, listEntities: () => [] } as unknown as PluginHost;
const serializer = { version: 'v1' } as unknown as FileSerializer;

describe('releaseService.createRelease — validation + one transaction (M17)', () => {
  let db: Database.Database;
  let cwd: string;

  function serviceWith(pageVersions: FileVersionService): ReleaseService {
    return new ReleaseService(
      db,
      fakeHost,
      {} as unknown as VersionService,
      pageVersions,
      serializer,
      {} as unknown as RawEntityReader,
      {} as unknown as TagsService,
      {} as unknown as PagesService,
      () => null,
      cwd,
      ['pages'],
    );
  }

  const releaseCount = (): number => (db.prepare('SELECT COUNT(*) AS n FROM spec_release').get() as { n: number }).n;
  const entityReleaseIds = (): Array<number | null> =>
    (db.prepare('SELECT release_id FROM entity_version ORDER BY entity_slug').all() as Array<{ release_id: number | null }>).map(
      (r) => r.release_id,
    );
  const fileReleaseIds = (): Array<number | null> =>
    (db.prepare('SELECT release_id FROM file_version ORDER BY path').all() as Array<{ release_id: number | null }>).map(
      (r) => r.release_id,
    );

  /** Expect `fn` to throw a DomainError with `code`. */
  function expectDomainError(fn: () => unknown, code: string): void {
    let caught: unknown;
    try {
      fn();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe(code);
  }

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-release-create-'));
    db = new Database(':memory:');
    runMigrations(db);
    // Unreleased captures queued at HEAD: two entity versions, two page versions.
    const ev = db.prepare(
      `INSERT INTO entity_version (entity_type, entity_slug, version, data, changed_by) VALUES ('endpoint', ?, 1, '{}', 'user')`,
    );
    ev.run('a-endpoint');
    ev.run('b-endpoint');
    const fv = db.prepare(
      `INSERT INTO file_version (path, version, data, serializer_version, op, changed_by, rootId) VALUES (?, 1, '# x', 'v1', 'create', 'user', 'pages')`,
    );
    fv.run('a.md');
    fv.run('b.md');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('[ac:ac-releaseservice-createrelease-name-des] validates name non-empty + UNIQUE and description non-empty + ≤ 500, then INSERTs spec_release and UPDATEs entity_version + file_version in one transaction', () => {
    const releases = serviceWith(new FileVersionService(db, serializer));

    // ── validation: every refusal creates nothing and assigns nothing ──
    expectDomainError(() => releases.createRelease({ name: '   ', description: 'd' }, 'user'), 'VALIDATION');
    expectDomainError(() => releases.createRelease({ name: 'v1', description: ' \n ' }, 'user'), 'RELEASE_DESCRIPTION_REQUIRED');
    expectDomainError(
      () => releases.createRelease({ name: 'v1', description: 'x'.repeat(501) }, 'user'),
      'RELEASE_DESCRIPTION_TOO_LONG',
    );
    expect(releaseCount()).toBe(0);
    expect(entityReleaseIds()).toEqual([null, null]);
    expect(fileReleaseIds()).toEqual([null, null]);

    // ── success: exactly 500 characters pass; the row is inserted and every
    //    unreleased entity_version + file_version row is assigned to it ──
    const created = releases.createRelease({ name: 'v1', description: 'y'.repeat(500) }, 'user');
    expect(releaseCount()).toBe(1);
    const row = db.prepare('SELECT id, name, description FROM spec_release').get() as {
      id: number;
      name: string;
      description: string;
    };
    expect(row).toEqual({ id: created.id, name: 'v1', description: 'y'.repeat(500) });
    expect(entityReleaseIds()).toEqual([created.id, created.id]);
    expect(fileReleaseIds()).toEqual([created.id, created.id]);
    expect(created.countBreakdown.entities).toEqual({ endpoint: 2 });

    // ── UNIQUE name: a second release with the same name is refused ──
    expectDomainError(() => releases.createRelease({ name: 'v1', description: 'again' }, 'user'), 'RELEASE_NAME_CONFLICT');
    expect(releaseCount()).toBe(1);

    // ── one transaction: a failure in the file_version step (after its UPDATE
    //    ran) rolls back the spec_release INSERT and the entity_version UPDATE too ──
    db.prepare(
      `INSERT INTO entity_version (entity_type, entity_slug, version, data, changed_by) VALUES ('endpoint', 'c-endpoint', 1, '{}', 'user')`,
    ).run();
    db.prepare(
      `INSERT INTO file_version (path, version, data, serializer_version, op, changed_by, rootId) VALUES ('c.md', 1, '# c', 'v1', 'create', 'user', 'pages')`,
    ).run();
    const failing = new FileVersionService(db, serializer);
    const realAssign = failing.assignToRelease.bind(failing);
    failing.assignToRelease = (releaseId: number, rootIds: string[]): number => {
      realAssign(releaseId, rootIds);
      throw new Error('file_version step failed');
    };
    expect(() => serviceWith(failing).createRelease({ name: 'v2', description: 'second' }, 'user')).toThrow(
      'file_version step failed',
    );
    expect(releaseCount()).toBe(1);
    expect(db.prepare(`SELECT 1 FROM spec_release WHERE name = 'v2'`).get()).toBeUndefined();
    expect(entityReleaseIds()).toEqual([created.id, created.id, null]);
    expect(fileReleaseIds()).toEqual([created.id, created.id, null]);
  });

  /** The `releases` root's file store over `cwd` (no watcher: the suppression is a no-op). */
  const releaseStoreIn = (dir: string): ReleaseFileStore =>
    new ReleaseFileStore(dir, '.claude4spec/releases', { suppress: () => {} } as SelfWriteSuppressor);
  const releaseFile = (slug: string): string => path.join(cwd, '.claude4spec', 'releases', `${slug}.json`);

  it('[entity:release-service-contract] [section:spdg8mon] [section:w6cocvik] createRelease(input, actor) → Release + countBreakdown; the spec_release cache row exists before the metadata file is written (transaction → file), no cache rebuild reads the file back, and the service itself never calls the git hook', () => {
    const releases = serviceWith(new FileVersionService(db, serializer));

    // The public surface the contract snippet names.
    for (const method of [
      'listReleases',
      'getRelease',
      'getReleaseSnapshot',
      'getReleaseDiff',
      'getCurrentSnapshot',
      'getUnreleasedDiff',
      'shadowDiff',
      'createRelease',
      'acceptShadow',
      'updateRelease',
      'restoreEntity',
      'restorePage',
      'restoreSpec',
    ] as const) {
      expect(typeof releases[method]).toBe('function');
    }
    // 2.1.55: the release is no longer a portable archive — the bundle pair
    // left the contract, and nothing on the service answers under either name.
    for (const removed of ['buildBundleArchive', 'restoreBundleArchive']) {
      expect(removed in releases).toBe(false);
    }

    const store = releaseStoreIn(cwd);
    const rowAtWrite: unknown[] = [];
    const realWrite = store.write.bind(store);
    store.write = (slug, data) => {
      // What the cache holds at the moment the file is written.
      rowAtWrite.push(db.prepare('SELECT name, slug, created_at FROM spec_release WHERE slug = ?').get(slug));
      realWrite(slug, data);
    };
    const read = vi.spyOn(store, 'read');
    releases.setReleaseStore(store);
    const commitOnRelease = vi.fn();
    const commitPull = vi.fn();
    releases.setGitService({ commitOnRelease, commitPull } as unknown as GitService);

    const created = releases.createRelease({ name: 'v1', description: 'first cut' }, 'user');

    expect(created).toMatchObject({ name: 'v1', description: 'first cut', createdBy: 'user' });
    expect(created.countBreakdown.entities).toEqual({ endpoint: 2 });
    // transaction → file: the row was already in spec_release when the file was written…
    expect(rowAtWrite).toEqual([{ name: 'v1', slug: 'v1', created_at: created.createdAt }]);
    // …the file carries the same stamp…
    expect(JSON.parse(fs.readFileSync(releaseFile('v1'), 'utf8'))).toMatchObject({
      name: 'v1',
      slug: 'v1',
      description: 'first cut',
      createdAt: created.createdAt,
      createdBy: 'user',
      roots: ['pages'],
    });
    // …and no separate cache-rebuild step read it back.
    expect(read).not.toHaveBeenCalled();
    expect(releases.listReleases().map((r) => r.name)).toEqual(['v1']);
    // The commit-on-release hook belongs to the channels, not to the service.
    expect(commitOnRelease).not.toHaveBeenCalled();
    expect(commitPull).not.toHaveBeenCalled();
  });

  it('[ac:ac-gdy-zapis-pliku-metadanych-po-zatwier] [section:spdg8mon] a metadata file write failing after the committed transaction of a plain createRelease leaves the spec_release row and its assignment; the error is logged, not thrown, and no file is left', () => {
    const releases = serviceWith(new FileVersionService(db, serializer));
    const store = releaseStoreIn(cwd);
    store.write = () => {
      throw new Error('disk full');
    };
    releases.setReleaseStore(store);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const created = releases.createRelease({ name: 'v1', description: 'first cut' }, 'user');

      // The release stands: its row, and the versions assigned to it.
      expect(db.prepare('SELECT id, name, slug FROM spec_release').all()).toEqual([
        { id: created.id, name: 'v1', slug: 'v1' },
      ]);
      expect(entityReleaseIds()).toEqual([created.id, created.id]);
      expect(fileReleaseIds()).toEqual([created.id, created.id]);
      expect(releases.getRelease('v1').id).toBe(created.id);
      // No metadata file (so no marker).
      expect(fs.existsSync(releaseFile('v1'))).toBe(false);
      // The failure went to the log.
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]![0])).toContain("'v1'");
      expect((error.mock.calls[0]![1] as Error).message).toBe('disk full');
    } finally {
      error.mockRestore();
    }
  });
});

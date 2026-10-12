import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { FileVersionService } from './file-version.js';
import { DomainError } from './tags.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from './file-serializer.js';
import type { VersionService } from './versions.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';

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
});

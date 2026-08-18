/**
 * Which entity types a release snapshot covers (0.2.11).
 *
 * The direct regression test for the bug this release fixes: `buildSnapshot`
 * used to iterate a hardcoded five, so `design-system`, `diagram` and every
 * plugin-contributed type were captured in `entity_version` but never read back
 * out — invisible in every release diff, unrecoverable from every release.
 *
 * These two cases pin both halves of the decision. The first is the fix. The
 * second is the deliberate limit on it: scope is ACTIVE modules, not every
 * module the host could load, because a snapshot may only name types this
 * installation can also diff, upgrade and re-import.
 */

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { diffEntity } from '../serialization/snapshot.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from './file-serializer.js';
import type { VersionService } from './versions.js';
import type { FileVersionService } from './file-version.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';

/**
 * Three ACTIVE types. `endpoint` stands for the types the old hardcoded list
 * already covered; `design-system` and `diagram` are the ones it silently
 * dropped. `retired` is deliberately absent from `listEntities()` — it has rows
 * in `entity_version`, as a deactivated type genuinely would.
 */
const ACTIVE = [
  { type: 'endpoint', payloadVersion: 1 },
  { type: 'design-system', payloadVersion: 2 },
  { type: 'diagram', payloadVersion: 1 },
];

const fakeHost = {
  listEntities: () => ACTIVE,
  getEntity: (type: string) => ACTIVE.find((m) => m.type === type) ?? null,
  diff: (type: string, a: unknown, b: unknown) => diffEntity(fakeHost, type, a, b),
} as unknown as PluginHost;

const fakeFileSerializer = { version: 'v1', diff: () => null } as unknown as FileSerializer;

function service(db: Database.Database): ReleaseService {
  return new ReleaseService(
    db,
    fakeHost,
    {} as unknown as VersionService,
    { assignToRelease: () => {} } as unknown as FileVersionService,
    fakeFileSerializer,
    {} as unknown as RawEntityReader,
    {} as unknown as TagsService,
    {} as unknown as PagesService,
  );
}

describe('ReleaseService — snapshot type coverage (0.2.11)', () => {
  let db: Database.Database;
  let releases: ReleaseService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    releases = service(db);
  });

  afterEach(() => db.close());

  function insertEntityVersion(type: string, slug: string, data: unknown): void {
    db.prepare(
      `INSERT INTO entity_version
        (entity_type, entity_slug, version, data, changed_by, release_id, serializer_version, op)
       VALUES (?, ?, 1, ?, 'user', NULL, 'v1', 'create')`,
    ).run(type, slug, JSON.stringify(data));
  }

  it('captures design-system and diagram, which the hardcoded five omitted', () => {
    insertEntityVersion('endpoint', 'e-1', { slug: 'e-1' });
    insertEntityVersion('design-system', 'ds-1', { slug: 'ds-1', name: 'DS' });
    insertEntityVersion('diagram', 'd-1', { slug: 'd-1', format: 'mermaid' });

    const snapshot = releases.getCurrentSnapshot();
    const captured = snapshot.entities.map((e) => `${e.type}/${e.slug}`).sort();

    expect(captured).toEqual(['design-system/ds-1', 'diagram/d-1', 'endpoint/e-1']);
  });

  it('records a serializer version for every covered type', () => {
    insertEntityVersion('design-system', 'ds-1', { slug: 'ds-1' });

    // Keyed SINGULAR by type id, independent of the bundle file name.
    expect(releases.getCurrentSnapshot().serializer_versions).toMatchObject({
      endpoint: '1',
      'design-system': '2',
      diagram: '1',
    });
  });

  /**
   * The scope limit. A deactivated type's rows keep their release binding — the
   * `UPDATE entity_version SET release_id` in `createRelease` is untyped — so
   * nothing is lost by excluding them here, and re-activating the type makes
   * every past snapshot complete again.
   */
  it('excludes a type that is not active, even though its rows exist', () => {
    insertEntityVersion('endpoint', 'e-1', { slug: 'e-1' });
    insertEntityVersion('retired', 'r-1', { slug: 'r-1' });

    const snapshot = releases.getCurrentSnapshot();

    expect(snapshot.entities.map((e) => e.type)).toEqual(['endpoint']);
    expect(snapshot.serializer_versions).not.toHaveProperty('retired');
    // The row is still there — excluded from the snapshot, not deleted.
    const rows = db.prepare(`SELECT COUNT(*) AS c FROM entity_version WHERE entity_type = 'retired'`).get() as {
      c: number;
    };
    expect(rows.c).toBe(1);
  });
});

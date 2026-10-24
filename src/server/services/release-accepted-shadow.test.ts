import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { ReleaseFileStore, readAcceptedShadow, toReleaseFileData } from './release-store.js';
import { ReleaseIndexerService } from './release-indexer.js';
import type { SelfWriteSuppressor } from '../fs/sources.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from './file-serializer.js';
import type { VersionService } from './versions.js';
import type { FileVersionService } from './file-version.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';

/**
 * 2.1.47 (M17 m17reldisk / mbjdcls0, M29 m29idx001 / m29mig001) — a release
 * remembers the shadow it accepted (`acceptedShadow: { id, tipSha }`) in its
 * metadata file, in the `spec_release` cache rebuilt from that file, and keeps it
 * across an edit of the latest release and across the DB→disk backfill. A file
 * without the field reads as `null`.
 *
 * Creating a release by accepting a shadow is a later unit; here a release that
 * accepted one is set up the way that path leaves it — the two columns set on
 * the row and the field written to the file.
 */

const fakeHost = { getEntity: () => null, listEntities: () => [] } as unknown as PluginHost;
const SHADOW = { id: 'run-42/spec', tipSha: '9f2c4e7a1b3d5f60718293a4b5c6d7e8f9012345' };

interface ShadowCols {
  accepted_shadow_id: string | null;
  accepted_shadow_sha: string | null;
}

describe('release acceptedShadow metadata (2.1.47)', () => {
  let dir: string;
  let db: Database.Database;
  let store: ReleaseFileStore;
  let indexer: ReleaseIndexerService;
  let releases: ReleaseService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-release-shadow-'));
    db = new Database(':memory:');
    runMigrations(db);
    const watcher = { suppress: () => {} } as SelfWriteSuppressor;
    store = new ReleaseFileStore(dir, 'releases', watcher);
    store.ensureRoot();
    indexer = new ReleaseIndexerService(db, store, watcher);
    releases = new ReleaseService(
      db,
      fakeHost,
      {} as unknown as VersionService,
      { assignToRelease: () => {} } as unknown as FileVersionService,
      { version: 'v1' } as unknown as FileSerializer,
      {} as unknown as RawEntityReader,
      {} as unknown as TagsService,
      {} as unknown as PagesService,
      () => null,
      dir,
      ['pages'],
      [path.join(dir, 'pages')],
    );
    releases.setReleaseStore(store);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const readFile = (slug: string) =>
    JSON.parse(fs.readFileSync(path.join(dir, 'releases', `${slug}.json`), 'utf8')) as Record<string, unknown>;
  const shadowCols = (slug: string) =>
    db.prepare(`SELECT accepted_shadow_id, accepted_shadow_sha FROM spec_release WHERE slug = ?`).get(slug) as ShadowCols;

  /** The state a shadow-accepting create leaves: row columns + file field. */
  function markAccepted(slug: string): void {
    db.prepare(`UPDATE spec_release SET accepted_shadow_id = ?, accepted_shadow_sha = ? WHERE slug = ?`).run(
      SHADOW.id,
      SHADOW.tipSha,
      slug,
    );
    store.write(slug, { ...store.read(slug), acceptedShadow: SHADOW });
  }

  it('[section:m17reldisk] the cache rebuild copies acceptedShadow from the release file into accepted_shadow_id / _sha', async () => {
    store.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'accepted a shadow',
      createdAt: '2026-10-01T10:00:00.000Z',
      createdBy: 'agent',
      roots: ['pages'],
      acceptedShadow: SHADOW,
    });
    await indexer.indexAll();
    expect(shadowCols('v1')).toEqual({ accepted_shadow_id: SHADOW.id, accepted_shadow_sha: SHADOW.tipSha });
    expect(releases.getRelease('v1').acceptedShadow).toEqual(SHADOW);
  });

  it('[section:m17reldisk] a release file without acceptedShadow rebuilds to NULL in both columns and reads as null', async () => {
    store.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'plain',
      createdAt: '2026-10-01T10:00:00.000Z',
      createdBy: 'user',
      roots: ['pages'],
      acceptedShadow: SHADOW,
    });
    await indexer.indexAll();
    // The field disappears from the file (e.g. a pull): the rebuild clears both columns.
    const { acceptedShadow: _drop, ...withoutField } = store.read('v1');
    store.write('v1', withoutField);
    await indexer.indexAll();

    expect(shadowCols('v1')).toEqual({ accepted_shadow_id: null, accepted_shadow_sha: null });
    expect(releases.getRelease('v1').acceptedShadow).toBeNull();
    expect(readAcceptedShadow(withoutField)).toBeNull();
  });

  it('[section:m17reldisk] a plain createRelease leaves acceptedShadow null on the row, absent from the file, null on the release', () => {
    const created = releases.createRelease({ name: 'v1', description: 'plain' }, 'user');
    expect(created.acceptedShadow).toBeNull();
    expect(shadowCols('v1')).toEqual({ accepted_shadow_id: null, accepted_shadow_sha: null });
    expect('acceptedShadow' in readFile('v1')).toBe(false);
    expect(releases.listReleases()[0]!.acceptedShadow).toBeNull();
  });

  it('[section:mbjdcls0] updateRelease of the latest release rewrites the file keeping acceptedShadow unchanged', async () => {
    releases.createRelease({ name: 'v1', description: 'accepted' }, 'agent');
    markAccepted('v1');

    const edited = await releases.updateRelease({ releaseName: 'v1', name: 'v1 final', description: 'edited' });

    expect(edited.acceptedShadow).toEqual(SHADOW);
    expect(fs.existsSync(path.join(dir, 'releases', 'v1.json'))).toBe(false);
    const file = readFile('v1-final');
    expect(file.description).toBe('edited');
    expect(file.acceptedShadow).toEqual(SHADOW);
    expect(shadowCols('v1-final')).toEqual({ accepted_shadow_id: SHADOW.id, accepted_shadow_sha: SHADOW.tipSha });
  });

  it('[section:mbjdcls0] a description-only edit of a release that accepted no shadow does not add the field', async () => {
    releases.createRelease({ name: 'v1', description: 'plain' }, 'user');
    await releases.updateRelease({ releaseName: 'v1', description: 'edited' });
    expect('acceptedShadow' in readFile('v1')).toBe(false);
    expect(shadowCols('v1')).toEqual({ accepted_shadow_id: null, accepted_shadow_sha: null });
  });

  it('[section:m29mig001] the DB→disk serializer writes acceptedShadow only for a row that has it', () => {
    const base = { name: 'v1', description: 'd', created_at: '2026-10-01T10:00:00.000Z', created_by: 'user' };
    const withShadow = toReleaseFileData(
      { ...base, accepted_shadow_id: SHADOW.id, accepted_shadow_sha: SHADOW.tipSha },
      'v1',
      ['pages'],
    );
    expect(withShadow.acceptedShadow).toEqual(SHADOW);

    // A row from before the field (no columns) and a row with NULL columns get no key at all.
    for (const row of [base, { ...base, accepted_shadow_id: null, accepted_shadow_sha: null }]) {
      const data = toReleaseFileData(row, 'v1', ['pages']);
      expect('acceptedShadow' in data).toBe(false);
      expect(Object.keys(data).sort()).toEqual(['createdAt', 'createdBy', 'description', 'name', 'roots', 'slug']);
    }
  });

  it('[section:m17reldisk] a malformed acceptedShadow in a file reads as null', () => {
    expect(readAcceptedShadow({})).toBeNull();
    expect(readAcceptedShadow({ acceptedShadow: null })).toBeNull();
    expect(readAcceptedShadow({ acceptedShadow: { id: 'run-1' } })).toBeNull();
    expect(readAcceptedShadow({ acceptedShadow: { id: 1, tipSha: 'abc' } })).toBeNull();
    expect(readAcceptedShadow({ acceptedShadow: SHADOW })).toEqual(SHADOW);
  });
});

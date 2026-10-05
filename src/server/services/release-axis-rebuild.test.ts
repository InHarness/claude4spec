import Database from 'better-sqlite3';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { ReleaseFileStore } from './release-store.js';
import { ReleaseIndexerService } from './release-indexer.js';
import { releasesRouter } from '../routes/releases.js';
import { errorHandler } from '../routes/errors.js';
import { compareBriefsByReleaseAxis } from '../../core/briefs/release-axis.js';
import type { SelfWriteSuppressor } from '../fs/sources.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from './file-serializer.js';
import type { VersionService } from './versions.js';
import type { FileVersionService } from './file-version.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';

/**
 * 2.1.4 (M17/M29/M21) — the release AXIS is `created_at, id`, not `id`.
 *
 * `spec_release` is a cache rebuilt from `<releasesDir>/<slug>.json`; on a fresh
 * database the ids follow directory order — alphabetical by slug, so `v0-10`
 * gets a LOWER id than `v0-8` and `v0-9`. Newest, editable release, list order
 * and brief rank must come out the same as before the rebuild.
 */

const fakeHost = { getEntity: () => null, listEntities: () => [] } as unknown as PluginHost;
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('release axis after a rebuild from releasesDir (2.1.4)', () => {
  let dir: string;
  let db: Database.Database;
  let store: ReleaseFileStore;
  let releases: ReleaseService;
  let indexer: ReleaseIndexerService;
  let app: express.Express;

  const writeFile = (name: string, createdAt: string) =>
    store.write(name.replace('.', '-'), {
      name,
      slug: name.replace('.', '-'),
      description: `release ${name}`,
      createdAt,
      createdBy: 'user',
      roots: ['pages'],
    });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-release-axis-'));
    db = new Database(':memory:');
    runMigrations(db);
    const watcher = { suppress: () => {} } as SelfWriteSuppressor;
    store = new ReleaseFileStore(dir, 'releases', watcher);
    store.ensureRoot();
    releases = new ReleaseService(
      db,
      fakeHost,
      {} as unknown as VersionService,
      { assignToRelease: () => {} } as unknown as FileVersionService,
      { version: 'v1' } as unknown as FileSerializer,
      {} as unknown as RawEntityReader,
      {} as unknown as TagsService,
      {} as unknown as PagesService,
    );
    releases.setReleaseStore(store);
    indexer = new ReleaseIndexerService(db, store, watcher);
    app = express().use(express.json()).use('/api/releases', releasesRouter(releases)).use(errorHandler);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const idOf = (name: string) =>
    (db.prepare('SELECT id FROM spec_release WHERE name = ?').get(name) as { id: number }).id;

  describe('three releases rebuilt on an empty database', () => {
    beforeEach(async () => {
      writeFile('v0.8', '2026-07-01T10:00:00.000Z');
      writeFile('v0.9', '2026-07-05T10:00:00.000Z');
      writeFile('v0.10', '2026-07-09T10:00:00.000Z');
      await indexer.indexAll();
    });

    it('assigns ids alphabetically by slug (the premise of the bug)', () => {
      expect(idOf('v0.10')).toBeLessThan(idOf('v0.8'));
      expect(idOf('v0.10')).toBeLessThan(idOf('v0.9'));
    });

    it('copies createdAt into created_at verbatim', () => {
      const rows = db.prepare('SELECT name, created_at FROM spec_release').all() as Array<{ name: string; created_at: string }>;
      for (const r of rows) expect(r.created_at).toBe(store.read(r.name.replace('.', '-')).createdAt);
    });

    it('GET /api/releases lists newest-first on the axis: v0.10, v0.9, v0.8', async () => {
      const res = await request(app).get('/api/releases');
      expect(res.status).toBe(200);
      expect(res.body.releases.map((r: { name: string }) => r.name)).toEqual(['v0.10', 'v0.9', 'v0.8']);
    });

    it('ranks releases by axis position, so the brief list keeps its order', () => {
      const rank = releases.releaseRankByName();
      expect(rank.get('v0.10')).toBeGreaterThan(rank.get('v0.9')!);
      expect(rank.get('v0.9')).toBeGreaterThan(rank.get('v0.8')!);
      const briefs = [
        { path: 'a.md', fromRelease: 'v0.8', toRelease: 'v0.9', generatedAt: null },
        { path: 'b.md', fromRelease: 'v0.9', toRelease: 'v0.10', generatedAt: null },
        { path: 'c.md', fromRelease: 'v0.10', toRelease: null, generatedAt: null },
      ];
      const sorted = [...briefs].sort((x, y) => compareBriefsByReleaseAxis(x, y, rank));
      expect(sorted.map((b) => b.path)).toEqual(['c.md', 'b.md', 'a.md']);
    });

    it('updateRelease accepts the release with the latest createdAt', async () => {
      const res = await request(app).patch('/api/releases/v0.10').send({ description: 'edited' });
      expect(res.status).toBe(200);
      expect(releases.getRelease('v0.10').description).toBe('edited');
    });

    it.each(['v0.9', 'v0.8'])('updateRelease on %s is 409 RELEASE_FROZEN', async (name) => {
      const res = await request(app).patch(`/api/releases/${name}`).send({ description: 'edited' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RELEASE_FROZEN');
    });

    it('a release created afterwards becomes the latest', async () => {
      const created = releases.createRelease({ name: 'v0.11', description: 'next' }, 'user');
      expect(releases.listReleases()[0]!.name).toBe('v0.11');
      expect(created.name).toBe('v0.11');
      const frozen = await request(app).patch('/api/releases/v0.10').send({ description: 'x' });
      expect(frozen.status).toBe(409);
    });
  });

  it('a file pulled in through git with an OLDER createdAt gets a higher id but sits below the local release', async () => {
    writeFile('local', '2026-07-09T10:00:00.000Z');
    await indexer.indexAll();
    writeFile('pulled', '2026-07-01T10:00:00.000Z');
    await indexer.indexAll();
    expect(idOf('pulled')).toBeGreaterThan(idOf('local'));
    expect(releases.listReleases().map((r) => r.name)).toEqual(['local', 'pulled']);
    expect((await request(app).patch('/api/releases/local').send({ description: 'ok' })).status).toBe(200);
    expect((await request(app).patch('/api/releases/pulled').send({ description: 'no' })).status).toBe(409);
  });

  it('createRelease stamps one ISO 8601 UTC ms value into the row and the file', async () => {
    releases.createRelease({ name: 'v1', description: 'first' }, 'user');
    const row = db.prepare('SELECT slug, created_at FROM spec_release WHERE name = ?').get('v1') as {
      slug: string;
      created_at: string;
    };
    expect(row.created_at).toMatch(ISO_MS);
    expect(store.read(row.slug).createdAt).toBe(row.created_at);
  });

  it('spec_release.created_at has no column default', () => {
    const col = (db.pragma('table_info(spec_release)') as Array<{ name: string; dflt_value: unknown }>).find(
      (c) => c.name === 'created_at',
    );
    expect(col?.dflt_value).toBeNull();
  });
});

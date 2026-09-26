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
import type { SelfWriteSuppressor } from '../fs/sources.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from './file-serializer.js';
import type { VersionService } from './versions.js';
import type { FileVersionService } from './file-version.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';

/**
 * 0.2.112 — release `description` is required and at most 500 Unicode code
 * points after trim, on write only (`createRelease` / `updateRelease`). Reads and
 * the cache rebuild from `releasesDir` never truncate or reject a longer one.
 */

const fakeHost = { getEntity: () => null, listEntities: () => [] } as unknown as PluginHost;

// Polish diacritics are one code point each; the trailing astral char is two
// UTF-16 units, so this proves code points — not `.length` — are counted.
const polish500 = 'Zażółć gęślą jaźń. '.repeat(27).slice(0, 499) + '𝄞';

describe('release description limit (0.2.112)', () => {
  let dir: string;
  let db: Database.Database;
  let store: ReleaseFileStore;
  let releases: ReleaseService;
  let app: express.Express;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-release-desc-'));
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
    app = express().use(express.json()).use('/api/releases', releasesRouter(releases)).use(errorHandler);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM spec_release').get() as { n: number }).n;

  it('accepts exactly 500 code points (Polish diacritics + an astral char)', async () => {
    expect([...polish500]).toHaveLength(500);
    expect(polish500.length).toBe(501); // UTF-16 units — must not be what is counted
    const res = await request(app).post('/api/releases').send({ name: 'v1', description: polish500 });
    expect(res.status).toBe(201);
    expect(res.body.description).toBe(polish500);
  });

  it('counts after trim — surrounding whitespace does not push it over', async () => {
    const res = await request(app)
      .post('/api/releases')
      .send({ name: 'v1', description: `   ${polish500}\n\n` });
    expect(res.status).toBe(201);
  });

  it('rejects 501 code points with 400 RELEASE_DESCRIPTION_TOO_LONG and creates nothing', async () => {
    const res = await request(app)
      .post('/api/releases')
      .send({ name: 'v1', description: polish500 + 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RELEASE_DESCRIPTION_TOO_LONG');
    expect(count()).toBe(0);
    expect(fs.existsSync(path.join(dir, 'releases', 'v1.json'))).toBe(false);
  });

  it('rejects a whitespace-only description on create with RELEASE_DESCRIPTION_REQUIRED', async () => {
    const res = await request(app).post('/api/releases').send({ name: 'v1', description: '  \n ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RELEASE_DESCRIPTION_REQUIRED');
  });

  describe('PATCH /api/releases/:nameOrId', () => {
    beforeEach(async () => {
      const res = await request(app).post('/api/releases').send({ name: 'v1', description: 'first' });
      expect(res.status).toBe(201);
    });

    it('rejects >500 with 400 RELEASE_DESCRIPTION_TOO_LONG and leaves the description unchanged', async () => {
      const res = await request(app)
        .patch('/api/releases/v1')
        .send({ description: polish500 + 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('RELEASE_DESCRIPTION_TOO_LONG');
      expect(releases.getRelease('v1').description).toBe('first');
    });

    it('rejects an empty / whitespace description with 400 RELEASE_DESCRIPTION_REQUIRED', async () => {
      for (const description of ['', '   \t']) {
        const res = await request(app).patch('/api/releases/v1').send({ description });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('RELEASE_DESCRIPTION_REQUIRED');
      }
      expect(releases.getRelease('v1').description).toBe('first');
    });

    it('rejects a rename to "current" with 400 RELEASE_NAME_RESERVED', async () => {
      const res = await request(app).patch('/api/releases/v1').send({ name: 'current' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('RELEASE_NAME_RESERVED');
    });

    it('accepts exactly 500 code points', async () => {
      const res = await request(app).patch('/api/releases/v1').send({ description: polish500 });
      expect(res.status).toBe(200);
      expect(releases.getRelease('v1').description).toBe(polish500);
    });
  });

  describe('data from before the limit', () => {
    const legacy = 'Opis sprzed limitu — '.repeat(40).trim(); // > 500 code points

    beforeEach(async () => {
      expect([...legacy].length).toBeGreaterThan(500);
      const watcher = { suppress: () => {} } as SelfWriteSuppressor;
      store.write('legacy', {
        name: 'legacy',
        slug: 'legacy',
        description: legacy,
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'user',
        roots: ['pages'],
      });
      await new ReleaseIndexerService(db, store, watcher).indexAll();
    });

    it('is rebuilt from releasesDir and read back without truncation or error', async () => {
      const res = await request(app).get('/api/releases/legacy');
      expect(res.status).toBe(200);
      expect(res.body.description).toBe(legacy);
      expect(releases.listReleases().find((r) => r.name === 'legacy')?.description).toBe(legacy);
    });

    it('a rename-only update of the latest release passes', async () => {
      const res = await request(app).patch('/api/releases/legacy').send({ name: 'legacy-2' });
      expect(res.status).toBe(200);
      expect(releases.getRelease('legacy-2').description).toBe(legacy);
    });

    it('an update carrying the long description again must shorten it', async () => {
      const res = await request(app).patch('/api/releases/legacy').send({ description: legacy });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('RELEASE_DESCRIPTION_TOO_LONG');
    });
  });
});

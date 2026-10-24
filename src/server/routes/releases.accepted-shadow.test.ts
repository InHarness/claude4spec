import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from '../services/release.js';
import { ReleaseFileStore } from '../services/release-store.js';
import { releasesRouter } from './releases.js';
import { errorHandler } from './errors.js';
import type { SelfWriteSuppressor } from '../fs/sources.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from '../services/file-serializer.js';
import type { VersionService } from '../services/versions.js';
import type { FileVersionService } from '../services/file-version.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from '../services/tags.js';
import type { PagesService } from '../services/pages.js';

/**
 * 2.1.47 — dto `release` field `accepted_shadow` (served as `acceptedShadow`,
 * like `created_by` → `createdBy`): `{ id, tipSha } | null` on every
 * `/api/releases` answer that carries a release; `null` for a release that did
 * not accept a shadow, including every one created through `POST /api/releases`.
 */

const fakeHost = { getEntity: () => null, listEntities: () => [] } as unknown as PluginHost;
const SHADOW = { id: 'run-42/spec', tipSha: '9f2c4e7a1b3d5f60718293a4b5c6d7e8f9012345' };

describe('/api/releases — acceptedShadow (2.1.47)', () => {
  let dir: string;
  let db: Database.Database;
  let store: ReleaseFileStore;
  let app: express.Express;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-release-shadow-route-'));
    db = new Database(':memory:');
    runMigrations(db);
    const watcher = { suppress: () => {} } as SelfWriteSuppressor;
    store = new ReleaseFileStore(dir, 'releases', watcher);
    store.ensureRoot();
    const releases = new ReleaseService(
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
    app = express().use(express.json()).use('/api/releases', releasesRouter(releases)).use(errorHandler);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const shadowCols = (name: string) =>
    db.prepare(`SELECT accepted_shadow_id, accepted_shadow_sha FROM spec_release WHERE name = ?`).get(name);

  /** The state a shadow-accepting create leaves on the row (that path is a later unit). */
  const markAccepted = (name: string) =>
    db
      .prepare(`UPDATE spec_release SET accepted_shadow_id = ?, accepted_shadow_sha = ? WHERE name = ?`)
      .run(SHADOW.id, SHADOW.tipSha, name);

  it('[ac:ac-post-api-releases-nie-ustawia-accepte] POST /api/releases never sets acceptedShadow, even when the body carries one', async () => {
    const res = await request(app)
      .post('/api/releases')
      .send({ name: 'v1', description: 'plain release', acceptedShadow: SHADOW, accepted_shadow: SHADOW });

    expect(res.status).toBe(201);
    // Response: the field is present and null.
    expect(res.body).toHaveProperty('acceptedShadow', null);
    // Cache row: both columns NULL.
    expect(shadowCols('v1')).toEqual({ accepted_shadow_id: null, accepted_shadow_sha: null });
    // Release file: no `acceptedShadow` key at all.
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'releases', 'v1.json'), 'utf8')) as Record<string, unknown>;
    expect('acceptedShadow' in file).toBe(false);
    // And a later read still reports null.
    const get = await request(app).get('/api/releases/v1');
    expect(get.body.acceptedShadow).toBeNull();
  });

  it('[entity:release] GET /api/releases/:name answers acceptedShadow as { id, tipSha } | null next to the existing fields', async () => {
    await request(app).post('/api/releases').send({ name: 'v1', description: 'plain' });
    await request(app).post('/api/releases').send({ name: 'v2', description: 'accepted a shadow' });
    markAccepted('v2');

    const plain = await request(app).get('/api/releases/v1');
    expect(plain.status).toBe(200);
    expect(plain.body.acceptedShadow).toBeNull();

    const accepted = await request(app).get('/api/releases/v2');
    expect(accepted.status).toBe(200);
    expect(accepted.body.acceptedShadow).toEqual(SHADOW);
    expect(typeof accepted.body.acceptedShadow.id).toBe('string');
    expect(typeof accepted.body.acceptedShadow.tipSha).toBe('string');
    // The required fields stay as they were.
    expect(typeof accepted.body.id).toBe('number');
    expect(accepted.body.name).toBe('v2');
    expect(typeof accepted.body.description).toBe('string');
    expect(typeof accepted.body.createdBy).toBe('string');
    expect(typeof accepted.body.createdAt).toBe('string');
    expect(typeof accepted.body.countBreakdown).toBe('object');
  });

  it('[entity:release] GET /api/releases lists acceptedShadow on every release', async () => {
    await request(app).post('/api/releases').send({ name: 'v1', description: 'plain' });
    await request(app).post('/api/releases').send({ name: 'v2', description: 'accepted a shadow' });
    markAccepted('v2');

    const res = await request(app).get('/api/releases');
    expect(res.status).toBe(200);
    const byName = new Map(
      (res.body.releases as Array<{ name: string; acceptedShadow: unknown }>).map((r) => [r.name, r.acceptedShadow]),
    );
    expect(byName.get('v1')).toBeNull();
    expect(byName.get('v2')).toEqual(SHADOW);
  });

  it('[entity:release] PATCH /api/releases/:name answers with acceptedShadow preserved', async () => {
    await request(app).post('/api/releases').send({ name: 'v1', description: 'accepted a shadow' });
    markAccepted('v1');

    const res = await request(app).patch('/api/releases/v1').send({ description: 'edited' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('edited');
    expect(res.body.acceptedShadow).toEqual(SHADOW);
  });
});

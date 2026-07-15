import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from '../services/release.js';
import { releasesRouter } from './releases.js';
import { errorHandler } from './errors.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from '../services/file-serializer.js';
import type { VersionService } from '../services/versions.js';
import type { FileVersionService } from '../services/file-version.js';
import type { RawEntityReader } from '../domain/raw-entity-reader.js';
import type { TagsService } from '../services/tags.js';
import type { PagesService } from '../services/pages.js';

// 0.1.122: this route never has real entity/page rows to diff — it only
// exercises the `:to === 'current'` dispatch ahead of `decodeIdOrName`
// (release.ts's diffing algorithm itself is covered by
// release-unreleased-diff.test.ts), so bare fakes suffice.
const fakeHost = { getEntity: () => null } as unknown as PluginHost;
const fakeFileSerializer = { version: 'v1' } as unknown as FileSerializer;
const fakeVersions = {} as unknown as VersionService;
const fakeFileVersions = { assignToRelease: () => {} } as unknown as FileVersionService;
const fakeRawReader = {} as unknown as RawEntityReader;
const fakeTagsService = {} as unknown as TagsService;
const fakePagesService = {} as unknown as PagesService;

describe('GET /api/releases/:from/diff/:to — "current" sentinel (0.1.122)', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    const releases = new ReleaseService(
      db,
      fakeHost,
      fakeVersions,
      fakeFileVersions,
      fakeFileSerializer,
      fakeRawReader,
      fakeTagsService,
      fakePagesService,
    );
    app = express().use(express.json()).use('/api/releases', releasesRouter(releases)).use(errorHandler);
  });

  afterEach(() => {
    db.close();
  });

  it('resolves :to=current BEFORE nameOrId lookup, returning 200 with to={id:0,name:"current"}', async () => {
    const create = await request(app).post('/api/releases').send({ name: 'v1', description: 'first' });
    expect(create.status).toBe(201);

    const res = await request(app).get('/api/releases/v1/diff/current');

    expect(res.status).toBe(200);
    expect(res.body.from).toEqual({ id: create.body.id, name: 'v1' });
    expect(res.body.to).toEqual({ id: 0, name: 'current' });
    expect(res.body.entities).toEqual([]);
    expect(res.body.pages).toEqual([]);
  });

  it('__INITIAL__ from + current to: from is null, to is current', async () => {
    const res = await request(app).get('/api/releases/__INITIAL__/diff/current');
    expect(res.status).toBe(200);
    expect(res.body.from).toBeNull();
    expect(res.body.to).toEqual({ id: 0, name: 'current' });
  });

  it('still 404s a real, unresolvable :to release name (unchanged behavior)', async () => {
    const res = await request(app).get('/api/releases/__INITIAL__/diff/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('POST /api/releases rejects the reserved name "current" with 400 RELEASE_NAME_RESERVED', async () => {
    const res = await request(app).post('/api/releases').send({ name: 'current', description: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RELEASE_NAME_RESERVED');
  });
});

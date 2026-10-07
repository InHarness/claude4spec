import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from '../services/release.js';
import { releasesRouter } from './releases.js';
import { errorHandler } from './errors.js';
import { releaseDiffOperation, releaseListOperation, releaseShowOperation } from '../services/release-operations.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from '../services/file-serializer.js';
import type { VersionService } from '../services/versions.js';
import type { FileVersionService } from '../services/file-version.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from '../services/tags.js';
import type { PagesService } from '../services/pages.js';

// 0.1.122: this route never has real entity/page rows to diff — it only
// exercises the `:to === 'current'` dispatch ahead of `decodeIdOrName`
// (release.ts's diffing algorithm itself is covered by
// release-unreleased-diff.test.ts), so bare fakes suffice.
// 0.2.11: `buildSnapshot` iterates `listEntities()`. This suite exercises the
// page/git side, so an empty type list is the right fake — it just has to exist.
const fakeHost = { getEntity: () => null, listEntities: () => [] } as unknown as PluginHost;
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

  it('2.1.11 — the empty state + current is 400 INVALID_DIFF_RANGE, also on the raw projection', async () => {
    for (const from of ['initial', 'null']) {
      const res = await request(app).get(`/api/releases/${from}/diff/current`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_DIFF_RANGE');
    }
  });

  it('still 404s a real, unresolvable :to release name (unchanged behavior)', async () => {
    const res = await request(app).get('/api/releases/initial/diff/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RELEASE_NOT_FOUND');
  });

  it('POST /api/releases rejects the reserved name "current" with 400 RELEASE_NAME_RESERVED', async () => {
    const res = await request(app).post('/api/releases').send({ name: 'current', description: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RELEASE_NAME_RESERVED');
  });
});

/**
 * 2.1.11 — `view=operation` on the release routes: the operation payload, the
 * same one the MCP tool returns, and a loud 400 for a parameter that belongs to
 * that view but came without it.
 */
describe('release routes — view=operation (2.1.11)', () => {
  let db: Database.Database;
  let app: express.Express;
  let releases: ReleaseService;
  const ROOTS = [
    { id: 'pages', releasable: true },
    { id: 'scratch', releasable: false },
  ];

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    releases = new ReleaseService(
      db,
      fakeHost,
      fakeVersions,
      fakeFileVersions,
      fakeFileSerializer,
      fakeRawReader,
      fakeTagsService,
      fakePagesService,
    );
    app = express()
      .use(express.json())
      .use('/api/releases', releasesRouter(releases, undefined, undefined, () => ROOTS))
      .use(errorHandler);
    for (let i = 1; i <= 7; i += 1) {
      const res = await request(app).post('/api/releases').send({ name: `v${i}`, description: `release ${i}` });
      expect(res.status).toBe(201);
    }
  });

  afterEach(() => {
    db.close();
  });

  it('GET /api/releases?view=operation windows at 5 by default and carries `total` inside `data`', async () => {
    const res = await request(app).get('/api/releases?view=operation');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(7);
    expect(res.body.data.releases).toHaveLength(5);
    expect(res.body.data).toEqual(releaseListOperation({ releaseService: releases, roots: () => ROOTS }, {}));
  });

  it('GET /api/releases without view keeps the full UI list', async () => {
    const res = await request(app).get('/api/releases');
    expect(res.status).toBe(200);
    expect(res.body.releases).toHaveLength(7);
  });

  it('limit without view → 400 INVALID_ARGUMENT pointing at view=operation', async () => {
    const res = await request(app).get('/api/releases?limit=2');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
    expect(JSON.stringify(res.body.error)).toContain('view=operation');
  });

  it('an unknown view → 400 INVALID_ARGUMENT', async () => {
    const res = await request(app).get('/api/releases/v1/snapshot?view=bogus');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
  });

  it('a diff filter on the raw projection → 400 INVALID_ARGUMENT', async () => {
    const res = await request(app).get('/api/releases/v1/diff/v2?roots=pages');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
  });

  it('snapshot view=operation equals release_show', async () => {
    const res = await request(app).get('/api/releases/v3/snapshot?view=operation&include=pages');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(
      releaseShowOperation({ releaseService: releases, roots: () => ROOTS }, { releaseName: 'v3', include: ['pages'] }),
    );
  });

  it('diff view=operation equals release_diff, for a release pair and for current', async () => {
    const deps = { releaseService: releases, roots: () => ROOTS };
    for (const [from, to] of [
      ['v1', 'v2'],
      ['initial', 'v2'],
      ['v7', 'current'],
    ] as const) {
      const res = await request(app).get(`/api/releases/${from}/diff/${to}?view=operation&summaryOnly=true&roots=pages`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(
        await releaseDiffOperation(deps, { fromReleaseName: from, toReleaseName: to, summaryOnly: true, roots: ['pages'] }),
      );
    }
  });

  it('server-side refusals reach REST with their own codes', async () => {
    const twoTypes = await request(app).get('/api/releases/v1/diff/v2?view=operation&entityTypes=a&entityTypes=b&slugs=x');
    expect(twoTypes.body.error.code).toBe('CONFLICTING_FILTERS');
    const emptySlug = await request(app).get('/api/releases/v1/diff/v2?view=operation&entityTypes=a&slugs=x&slugs=');
    expect(emptySlug.body.error.code).toBe('INVALID_SLUGS_FILTER');
    const toInitial = await request(app).get('/api/releases/v1/diff/initial');
    expect(toInitial.status).toBe(400);
    expect(toInitial.body.error.code).toBe('INVALID_DIFF_RANGE');
    const fromCurrent = await request(app).get('/api/releases/current/diff/v2?view=operation');
    expect(fromCurrent.body.error.code).toBe('INVALID_DIFF_RANGE');
    const missing = await request(app).get('/api/releases/v1/diff/nope?view=operation');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RELEASE_NOT_FOUND');
  });

  it('a name carrying `/` is addressed percent-encoded in one segment', async () => {
    const create = await request(app).post('/api/releases').send({ name: 'team/v1', description: 'slash' });
    expect(create.status).toBe(201);
    const res = await request(app).get('/api/releases/team%2Fv1/diff/current?view=operation');
    expect(res.status).toBe(200);
    expect(res.body.data.from.name).toBe('team/v1');
  });

  it.each(['current', 'initial', 'null'])('POST /api/releases rejects the reserved name %s', async (name) => {
    const res = await request(app).post('/api/releases').send({ name, description: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RELEASE_NAME_RESERVED');
  });

  it.each(['initial', 'null'])('PATCH rename of the latest release to %s → RELEASE_NAME_RESERVED', async (name) => {
    const res = await request(app).patch('/api/releases/v7').send({ name });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RELEASE_NAME_RESERVED');
  });
});

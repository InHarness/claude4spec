import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from '../services/release.js';
import { releasesRouter } from './releases.js';
import { GitService } from '../services/git.js';
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
// exercises the `:to === 'current'` dispatch ahead of the name lookup
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

describe('GET /api/releases/:from/diff/:to — `roots` refusal (2.1.8, M17 m17errtx1)', () => {
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
      () => null,
      process.cwd(),
      // The roots of kind `pages` — the only ids the page filter accepts.
      ['pages', 'plugins'],
      [],
    );
    app = express().use(express.json()).use('/api/releases', releasesRouter(releases)).use(errorHandler);
  });

  afterEach(() => {
    db.close();
  });

  // 2.1.11: the raw projection takes no filters, so the `roots` filter rides
  // `view=operation` — the same core operation `release_diff` calls.
  it.each([
    ['an unknown root id', 'nope', 'v1/diff/current'],
    ['the `entities` system root', 'entities', 'v1/diff/current'],
    ['the `releases` system root', 'releases', 'initial/diff/v2'],
    ['the `plans` system root', 'plans', 'v1/diff/v2'],
  ])('refuses %s with 400 INVALID_ROOTS_FILTER listing the `kind: pages` roots', async (_label, root, route) => {
    const res = await request(app).get(`/api/releases/${route}?view=operation&roots=pages&roots=${root}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ROOTS_FILTER');
    expect(res.body.error.message).toBe(`roots: '${root}' is not a page root (page roots: [pages, plugins])`);
    expect(res.body.error.hint).toBe('page roots: [pages, plugins]');
  });
});

/**
 * 2.1.8 (M28 aqys9dje): with `git.enabled === true` and a detected repo, creating
 * a release commits — best-effort — the dir of every registry root + config.json,
 * with the message composed from the release's name and description. `enabled`
 * alone is the gate: no sub-toggle exists.
 */
describe('POST /api/releases — commit-on-release (M28)', () => {
  let db: Database.Database;
  let cwd: string;
  let app: express.Express;
  const git = (...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-rel-git-'));
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(cwd, 'seed.txt'), 'seed');
    git('add', 'seed.txt');
    git('commit', '-m', 'seed');
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude4spec', 'config.json'),
      JSON.stringify({
        $schemaVersion: 4,
        name: 'p',
        roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }],
        // A stale legacy sub-toggle set to false: it no longer exists, so it
        // cannot hold the commit back — `enabled` alone is the gate.
        git: { enabled: true, syncCommitOnRelease: false },
      }),
    );
    fs.mkdirSync(path.join(cwd, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'pages', 'a.md'), '# a');
    fs.mkdirSync(path.join(cwd, '.claude4spec', 'entities'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude4spec', 'entities', 'tags.json'), '[]');
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
    const gitService = new GitService(cwd, [path.join(cwd, 'pages')]);
    app = express().use(express.json()).use('/api/releases', releasesRouter(releases, undefined, gitService)).use(errorHandler);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('[ac:ac-przy-w-czonym-config-git-synccommitonre] git.enabled alone makes createRelease commit the registry roots + config.json with a message from the release name and description', async () => {
    const res = await request(app).post('/api/releases').send({ name: 'v1', description: 'first cut' });
    expect(res.status).toBe(201);
    expect(res.body.gitSync.status).toBe('committed');

    // ASSUMPTION:dev-0013 — the message is `{name}\n\n{description}` (no `Release ` prefix).
    expect(git('log', '-1', '--format=%B').trim()).toBe('v1\n\nfirst cut');
    const tracked = git('ls-tree', '-r', '--name-only', 'HEAD').split('\n');
    expect(tracked).toContain('pages/a.md');
    expect(tracked).toContain('.claude4spec/entities/tags.json');
    expect(tracked).toContain('.claude4spec/config.json');
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
  // 2.1.8: the operation is handed the `kind: pages` roots only.
  const ROOTS = [{ id: 'pages' }];

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

  // 2.1.11 — a release is addressed by its NAME alone; a segment is never an id.
  it('GET /api/releases/team%2Fv1 addresses the release `team/v1`', async () => {
    await request(app).post('/api/releases').send({ name: 'team/v1', description: 'slash' }).expect(201);
    const res = await request(app).get('/api/releases/team%2Fv1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('team/v1');
  });

  it('a digit segment is a name: GET /api/releases/12/snapshot answers the release NAMED 12', async () => {
    // Ids 1..7 are v1..v7, so `3` names no release even though id 3 exists.
    const missing = await request(app).get('/api/releases/3');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RELEASE_NOT_FOUND');

    await request(app).post('/api/releases').send({ name: '12', description: 'named twelve' }).expect(201);
    const res = await request(app).get('/api/releases/12/snapshot');
    expect(res.status).toBe(200);
    expect(res.body.release.name).toBe('12');
    const diff = await request(app).get('/api/releases/v1/diff/12');
    expect(diff.status).toBe(200);
    expect(diff.body.to.name).toBe('12');
  });

  it.each(['current', 'initial', 'null'])('a literal in the name position is 404 RELEASE_NOT_FOUND: %s', async (literal) => {
    for (const req of [
      request(app).get(`/api/releases/${literal}`),
      request(app).get(`/api/releases/${literal}/snapshot`),
      request(app).patch(`/api/releases/${literal}`).send({ description: 'x' }),
      request(app).post(`/api/releases/${literal}/restore`).send({ scope: 'spec' }),
    ]) {
      const res = await req;
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('RELEASE_NOT_FOUND');
    }
  });

  it('PATCH on a missing name is 404 before RELEASE_FROZEN; on a frozen name it is 409', async () => {
    const missing = await request(app).patch('/api/releases/nope').send({ description: 'x' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RELEASE_NOT_FOUND');
    const frozen = await request(app).patch('/api/releases/v1').send({ description: 'x' });
    expect(frozen.status).toBe(409);
    expect(frozen.body.error.code).toBe('RELEASE_FROZEN');
  });
});

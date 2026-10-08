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

  it.each([
    ['an unknown root id', 'nope', '__INITIAL__/diff/current'],
    ['the `entities` system root', 'entities', '__INITIAL__/diff/current'],
    ['the `releases` system root', 'releases', '__INITIAL__/diff/current'],
    ['the `plans` system root', 'plans', 'v1/diff/v2'],
  ])('refuses %s with 400 INVALID_ROOTS_FILTER listing the `kind: pages` roots', async (_label, root, route) => {
    const res = await request(app).get(`/api/releases/${route}?roots=pages&roots=${root}`);
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

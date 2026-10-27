import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from '../services/release.js';
import { releasesRouter } from './releases.js';
import { gitRouter } from './git.js';
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
import { ReleaseFileStore } from '../services/release-store.js';

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

    // 2.1.14 (M28 aqys9dje): the message is `{name}\n\n{description}` — no `Release ` prefix.
    expect(git('log', '-1', '--format=%B').trim()).toBe('v1\n\nfirst cut');
    const tracked = git('ls-tree', '-r', '--name-only', 'HEAD').split('\n');
    expect(tracked).toContain('pages/a.md');
    expect(tracked).toContain('.claude4spec/entities/tags.json');
    expect(tracked).toContain('.claude4spec/config.json');
  });

  /** Rewrite the project's `git` config block (read per call — hot-reload). */
  function setGitConfig(gitCfg: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(cwd, '.claude4spec', 'config.json'),
      JSON.stringify({
        $schemaVersion: 4,
        name: 'p',
        roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }],
        git: gitCfg,
      }),
    );
  }

  const branchExists = (name: string): boolean => {
    try {
      git('rev-parse', '--verify', `refs/heads/${name}`);
      return true;
    } catch {
      return false;
    }
  };

  it('[ac:ac-gdy-docelowy-branch-tryb-named-zniknal] named target branch gone between configuration and release → gitSync status error with recovery.kind branch-missing, the branch is not created, the release stays created', async () => {
    git('branch', 'release-target');
    setGitConfig({ enabled: true, commitTarget: { mode: 'named', branch: 'release-target' } });
    git('branch', '-D', 'release-target'); // removed after it was configured

    const res = await request(app).post('/api/releases').send({ name: 'v1', description: 'first cut' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('v1');
    expect(res.body.gitSync.status).toBe('error');
    expect(res.body.gitSync.recovery.operation).toBe('commit-on-release');
    expect(res.body.gitSync.recovery.kind).toBe('branch-missing');
    expect(res.body.gitSync.recovery.intentPrompt).toBeTruthy();
    expect(branchExists('release-target')).toBe(false);

    const persisted = await request(app).get('/api/releases/v1');
    expect(persisted.status).toBe(200);
    expect(persisted.body.name).toBe('v1');
  });

  it('[ac:ac-gdy-explicit-committarget-base-tryb-new] explicit commitTarget.base (mode new) gone before the release → gitSync status error with recovery.kind base-missing, the release itself succeeds', async () => {
    git('branch', 'base-branch');
    setGitConfig({ enabled: true, commitTarget: { mode: 'new', template: 'release/{release_slug}', base: 'base-branch' } });
    git('branch', '-D', 'base-branch');

    const res = await request(app).post('/api/releases').send({ name: 'v1', description: 'first cut' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('v1');
    expect(res.body.gitSync.status).toBe('error');
    expect(res.body.gitSync.recovery.kind).toBe('base-missing');
    expect(branchExists('release/v1')).toBe(false);

    const persisted = await request(app).get('/api/releases/v1');
    expect(persisted.status).toBe(200);
  });

  const commitSubjects = (): string[] => git('log', '--all', '--format=%s').split('\n').filter(Boolean);

  it('[entity:release] 2.1.47: gitSync carries the repair context of an open merge — a release commit that fails while MERGE_HEAD is open answers gitSync { status: error, recovery.kind: merge-open, operation commit-on-release }; the release exists, the merge stays open', async () => {
    // A shadow-like branch merged into the index without a commit (MERGE_HEAD open).
    git('checkout', '-q', '-b', 'shadow');
    fs.writeFileSync(path.join(cwd, 'pages', 'from-shadow.md'), '# shadow');
    git('add', 'pages/from-shadow.md');
    git('commit', '-q', '-m', 'shadow turn');
    git('checkout', '-q', 'main');
    git('merge', '--no-commit', '--no-ff', 'shadow');
    // A local pre-commit hook refuses the release (merge) commit.
    const hooks = path.join(cwd, 'test-hooks');
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho "pre-commit refused the commit" >&2\nexit 1\n', { mode: 0o755 });
    git('config', 'core.hooksPath', hooks);
    // Named target: an open merge still takes the `current` path, so the failure is merge-open, not a target error.
    git('branch', 'release-target');
    setGitConfig({ enabled: true, commitTarget: { mode: 'named', branch: 'release-target' } });

    const res = await request(app).post('/api/releases').send({ name: 'v1', description: 'accepts a shadow' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('v1');
    expect(res.body.gitSync.status).toBe('error');
    expect(typeof res.body.gitSync.message).toBe('string');
    expect(res.body.gitSync.recovery.operation).toBe('commit-on-release');
    expect(res.body.gitSync.recovery.kind).toBe('merge-open');
    expect(res.body.gitSync.recovery.gitStderr).toContain('pre-commit refused the commit');
    expect(res.body.gitSync.recovery.intentPrompt).toContain('merge is still open');
    // The merge is still open and no commit landed on either branch.
    expect(git('rev-parse', '-q', '--verify', 'MERGE_HEAD').trim()).toBe(git('rev-parse', 'shadow').trim());
    expect(commitSubjects()).not.toContain('v1');
    expect((await request(app).get('/api/releases/v1')).status).toBe(200);
  });

  it('[section:w6cocvik] [section:spdg8mon] the route calls commit-on-release after createRelease returns, whatever the outcome of the metadata file write: a failed write still commits, the commit carries no release file and is not a marker; a written file makes the next commit its marker', async () => {
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
    const store = new ReleaseFileStore(cwd, '.claude4spec/releases', { suppress: () => {} });
    const realWrite = store.write.bind(store);
    let failWrite = true;
    store.write = (slug, data) => {
      if (failWrite) throw new Error('disk full');
      realWrite(slug, data);
    };
    releases.setReleaseStore(store);
    const gitService = new GitService(cwd, [path.join(cwd, 'pages')]);
    const routeApp = express()
      .use(express.json())
      .use('/api/releases', releasesRouter(releases, undefined, gitService))
      .use(errorHandler);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await request(routeApp).post('/api/releases').send({ name: 'v1', description: 'first cut' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('v1');
      expect(error).toHaveBeenCalledTimes(1); // the failed write was logged…
      expect(res.body.gitSync.status).toBe('committed'); // …and the hook ran anyway
      expect(git('log', '-1', '--format=%B').trim()).toBe('v1\n\nfirst cut');
      const tracked = git('ls-tree', '-r', '--name-only', 'HEAD').split('\n');
      expect(tracked).toContain('pages/a.md');
      expect(tracked).not.toContain('.claude4spec/releases/v1.json');
      expect(await gitService.resolveReleaseCommit(path.join(cwd, '.claude4spec', 'releases', 'v1.json'))).toBeNull();

      failWrite = false;
      const next = await request(routeApp).post('/api/releases').send({ name: 'v2', description: 'second cut' });
      expect(next.status).toBe(201);
      expect(next.body.gitSync.status).toBe('committed');
      expect(git('ls-tree', '-r', '--name-only', 'HEAD').split('\n')).toContain('.claude4spec/releases/v2.json');
      expect(await gitService.resolveReleaseCommit(path.join(cwd, '.claude4spec', 'releases', 'v2.json'))).toBe(
        git('rev-parse', 'HEAD').trim(),
      );
    } finally {
      error.mockRestore();
    }
  });

  it('[ac:ac-commitforrelease-i-push-honoruja-master] [entity:release] with git.enabled=false commitOnRelease does not run — createRelease answers gitSync: null and makes no commit; no commit-on-release sub-toggle can switch it on', async () => {
    // A legacy sub-toggle left `true` is not a switch: `enabled` is the only gate.
    setGitConfig({ enabled: false, syncCommitOnRelease: true });
    fs.writeFileSync(path.join(cwd, 'pages', 'b.md'), '# b'); // work a commit would pick up

    const res = await request(app).post('/api/releases').send({ name: 'v1', description: 'first cut' });

    expect(res.status).toBe(201);
    expectReleasePayload(res.body);
    expect(res.body.name).toBe('v1');
    expect(res.body).toHaveProperty('gitSync', null);
    expect(commitSubjects()).toEqual(['seed']); // SQLite-only: the repository is untouched
    expect(git('status', '--porcelain')).toContain('pages/');
  });

  it('[ac:ac-przy-detached-head-lub-unborn-branch-d] detached HEAD in commitTarget `current` → createRelease answers gitSync: null and makes no commit', async () => {
    setGitConfig({ enabled: true, commitTarget: { mode: 'current' } });
    git('checkout', '--detach');
    const head = git('rev-parse', 'HEAD').trim();

    const res = await request(app).post('/api/releases').send({ name: 'v1', description: 'first cut' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('v1');
    expect(res.body).toHaveProperty('gitSync', null);
    expect(git('rev-parse', 'HEAD').trim()).toBe(head);
    expect(commitSubjects()).toEqual(['seed']);
  });

  it('[ac:ac-przy-detached-head-lub-unborn-branch-d] unborn branch (fresh repo, 0 commits) in commitTarget `current` → the first release answers gitSync: null and creates no initial commit', async () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-rel-unborn-'));
    const gitFresh = (...args: string[]): string => execFileSync('git', args, { cwd: fresh, encoding: 'utf8' });
    const freshDb = new Database(':memory:');
    try {
      gitFresh('init', '-b', 'main');
      gitFresh('config', 'user.email', 'test@example.com');
      gitFresh('config', 'user.name', 'Test');
      fs.mkdirSync(path.join(fresh, '.claude4spec'), { recursive: true });
      fs.writeFileSync(
        path.join(fresh, '.claude4spec', 'config.json'),
        JSON.stringify({
          $schemaVersion: 4,
          name: 'p',
          roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }],
          git: { enabled: true, commitTarget: { mode: 'current' } },
        }),
      );
      fs.mkdirSync(path.join(fresh, 'pages'), { recursive: true });
      fs.writeFileSync(path.join(fresh, 'pages', 'a.md'), '# a');
      runMigrations(freshDb);
      const freshReleases = new ReleaseService(
        freshDb,
        fakeHost,
        fakeVersions,
        fakeFileVersions,
        fakeFileSerializer,
        fakeRawReader,
        fakeTagsService,
        fakePagesService,
      );
      const freshApp = express()
        .use(express.json())
        .use('/api/releases', releasesRouter(freshReleases, undefined, new GitService(fresh, [path.join(fresh, 'pages')])))
        .use(errorHandler);

      const res = await request(freshApp).post('/api/releases').send({ name: 'v1', description: 'first cut' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('v1');
      expect(res.body).toHaveProperty('gitSync', null);
      // Still unborn: no initial commit was made by git sync.
      expect(() => gitFresh('rev-parse', '--verify', '--quiet', 'HEAD')).toThrow();
      expect(gitFresh('rev-list', '--all', '--count').trim()).toBe('0');
    } finally {
      freshDb.close();
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });
});

/**
 * Dto `release` (M17) on the live payload — every required field with its type,
 * and the additive `gitSync` (an object or `null`). ASSUMPTION:m28k-dev-0001 —
 * the wire names stay camelCase (`createdBy`, `createdAt`, `countBreakdown`)
 * where the dto writes `created_by`, `created_at`, `count_breakdown`.
 */
function expectReleasePayload(body: Record<string, unknown>): void {
  expect(typeof body.id).toBe('number');
  expect(typeof body.name).toBe('string');
  expect(typeof body.description).toBe('string');
  expect(typeof body.createdBy).toBe('string');
  expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(body.countBreakdown).toEqual(
    expect.objectContaining({ entities: expect.any(Object), pages: expect.any(Number), total: expect.any(Number) }),
  );
  expect('gitSync' in body).toBe(true);
  expect(body.gitSync === null || typeof body.gitSync === 'object').toBe(true);
}

/**
 * 2.1.14 (M17 mbjdcls0, M28 aqys9dje) — `PATCH /api/releases/:name` with
 * `{ name?, description?, assignUnreleased? }`. Its `gitSync` is `null` ONLY
 * when no pull ran; git off / no repo answer `commitPull`'s `skipped`
 * (unlike `POST /api/releases`, where those cases are `null`); git on commits
 * the working tree (`Pull to <name>`).
 */
describe('PATCH /api/releases/:name — gitSync of the pull commit (M17 + M28)', () => {
  let db: Database.Database;
  let cwd: string;
  let app: express.Express;
  const git = (...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

  function writeProjectConfig(gitCfg: Record<string, unknown>): void {
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude4spec', 'config.json'),
      JSON.stringify({
        $schemaVersion: 4,
        name: 'p',
        roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }],
        git: gitCfg,
      }),
    );
  }

  /** Release service + router over `cwd`, both wired with a real GitService (as project-context wires them). */
  function mount(): void {
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
    releases.setGitService(gitService);
    app = express().use(express.json()).use('/api/releases', releasesRouter(releases, undefined, gitService)).use(errorHandler);
  }

  function initRepo(): void {
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(cwd, 'seed.txt'), 'seed');
    git('add', 'seed.txt');
    git('commit', '-m', 'seed');
  }

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-rel-patch-'));
    fs.mkdirSync(path.join(cwd, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'pages', 'a.md'), '# a');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('[ac:ac-rest-patch-api-releases-nameorid-z-bod] [entity:release] git on: assignUnreleased commits the working tree (commitPull) and gitSync carries the commit; a PATCH with no pull answers gitSync: null', async () => {
    initRepo();
    writeProjectConfig({ enabled: true });
    mount();
    await request(app).post('/api/releases').send({ name: 'v1', description: 'first cut' }).expect(201);
    fs.writeFileSync(path.join(cwd, 'pages', 'b.md'), '# b'); // unreleased work in the working tree

    const pull = await request(app).patch('/api/releases/v1').send({ description: 'first cut, pulled', assignUnreleased: true });

    expect(pull.status).toBe(200);
    expectReleasePayload(pull.body);
    expect(pull.body.description).toBe('first cut, pulled');
    expect(pull.body.gitSync).toMatchObject({ status: 'committed' });
    expect(git('log', '-1', '--format=%s').trim()).toBe('Pull to v1');
    expect(git('ls-tree', '-r', '--name-only', 'HEAD').split('\n')).toContain('pages/b.md');

    // No pull requested → no pull ran → null.
    const rename = await request(app).patch('/api/releases/v1').send({ name: 'v1.0' });
    expect(rename.status).toBe(200);
    expect(rename.body.name).toBe('v1.0');
    expect(rename.body).toHaveProperty('gitSync', null);
  });

  it('[ac:ac-rest-patch-api-releases-nameorid-z-bod] git off: assignUnreleased answers gitSync { status: "skipped" } (not null) and commits nothing', async () => {
    initRepo();
    writeProjectConfig({ enabled: false });
    mount();
    const created = await request(app).post('/api/releases').send({ name: 'v1', description: 'first cut' });
    expect(created.body).toHaveProperty('gitSync', null); // the create gate: null

    const pull = await request(app).patch('/api/releases/v1').send({ assignUnreleased: true });

    expect(pull.status).toBe(200);
    expect(pull.body.gitSync).toEqual({ status: 'skipped' });
    expect(git('log', '--all', '--format=%s').split('\n').filter(Boolean)).toEqual(['seed']);
  });

  it('[ac:ac-rest-patch-api-releases-nameorid-z-bod] no repository: assignUnreleased answers gitSync { status: "skipped" } (not null)', async () => {
    writeProjectConfig({ enabled: true }); // git on, but `cwd` is no git worktree
    mount();
    await request(app).post('/api/releases').send({ name: 'v1', description: 'first cut' }).expect(201);

    const pull = await request(app).patch('/api/releases/v1').send({ assignUnreleased: true });

    expect(pull.status).toBe(200);
    expect(pull.body.gitSync).toEqual({ status: 'skipped' });
  });

  it('[ac:ac-gdy-repo-zniknelo-miedzy-akcjami-przeni] the repository vanishing between actions (`.git` removed) → GET /api/git/status reports detected: false, the next release answers gitSync null and the pull gitSync { status: "skipped" } — no error anywhere', async () => {
    initRepo();
    writeProjectConfig({ enabled: true });
    mount();
    const status = express()
      .use('/api/git', gitRouter(new GitService(cwd, [path.join(cwd, 'pages')])))
      .use(errorHandler);
    const first = await request(app).post('/api/releases').send({ name: 'v1', description: 'first cut' });
    expect(first.status).toBe(201);
    expect(first.body.gitSync).toMatchObject({ status: 'committed' });
    expect((await request(status).get('/api/git/status')).body.detected).toBe(true);

    fs.rmSync(path.join(cwd, '.git'), { recursive: true, force: true }); // the repository is gone

    const after = await request(status).get('/api/git/status');
    expect(after.status).toBe(200);
    expect(after.body.detected).toBe(false);
    expect(after.body.rootPath).toBeNull();

    fs.writeFileSync(path.join(cwd, 'pages', 'b.md'), '# b');
    const second = await request(app).post('/api/releases').send({ name: 'v2', description: 'second cut' });
    expect(second.status).toBe(201);
    expect(second.body).toHaveProperty('gitSync', null);

    const pull = await request(app).patch('/api/releases/v2').send({ assignUnreleased: true });
    expect(pull.status).toBe(200);
    expect(pull.body.gitSync).toEqual({ status: 'skipped' });
    expect(fs.existsSync(path.join(cwd, '.git'))).toBe(false); // nothing re-created the repository
  });

  it('[ac:ac-wariant-error-gitcommitresult-gitpushres] a failed git commit answers gitSync { status: error, message } plus the additive recovery { operation, reason, gitStderr, intentPrompt } — operation commit-on-release on createRelease, pull on updateRelease', async () => {
    initRepo();
    writeProjectConfig({ enabled: true });
    // A pre-commit hook that refuses every commit — a plain git failure (no `kind`).
    // A local core.hooksPath wins over any ambient global one.
    const hooks = path.join(cwd, 'test-hooks');
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho "pre-commit refused the commit" >&2\nexit 1\n', { mode: 0o755 });
    git('config', 'core.hooksPath', hooks);
    mount();

    const expectRecovery = (gitSync: Record<string, unknown>, operation: string): void => {
      // What an old consumer reads is intact: status + message …
      expect(gitSync.status).toBe('error');
      expect(typeof gitSync.message).toBe('string');
      // … and the recovery payload rides alongside, composed by the backend.
      const recovery = gitSync.recovery as Record<string, unknown>;
      expect(recovery.operation).toBe(operation);
      expect(typeof recovery.reason).toBe('string');
      expect(recovery.reason).not.toBe('');
      expect(recovery.gitStderr).toContain('pre-commit refused the commit');
      expect(typeof recovery.intentPrompt).toBe('string');
      expect(recovery.intentPrompt).toContain('pre-commit refused the commit');
      expect(recovery.kind).toBeUndefined();
    };

    const created = await request(app).post('/api/releases').send({ name: 'v1', description: 'first cut' });
    expect(created.status).toBe(201); // the release itself is created
    expectRecovery(created.body.gitSync, 'commit-on-release');

    fs.writeFileSync(path.join(cwd, 'pages', 'b.md'), '# b');
    const pull = await request(app).patch('/api/releases/v1').send({ assignUnreleased: true });
    expect(pull.status).toBe(200);
    expectRecovery(pull.body.gitSync, 'pull');
    expect(git('log', '--all', '--format=%s').split('\n').filter(Boolean)).toEqual(['seed']);
  });

  it('[ac:ac-b-d-operacji-git-brak-gita-w-path-bra] a git operation that fails (the repository broken under the app: a stale index.lock) never changes the outcome of the release or the pull — 201/200, the release persisted and updated, gitSync { status: error, message, recovery }', async () => {
    initRepo();
    writeProjectConfig({ enabled: true });
    mount();
    // Another git process left the index locked: every `git add` now fails.
    fs.writeFileSync(path.join(cwd, '.git', 'index.lock'), '');

    const created = await request(app).post('/api/releases').send({ name: 'v1', description: 'first cut' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('v1');
    expect(created.body.gitSync.status).toBe('error');
    expect(created.body.gitSync.message).toContain('index.lock');
    expect(created.body.gitSync.recovery).toMatchObject({ operation: 'commit-on-release' });
    expect(created.body.gitSync.recovery.gitStderr).toContain('index.lock');
    expect(created.body.gitSync.recovery.intentPrompt).toBeTruthy();
    // No push follows a commit that did not land.
    expect(created.body.gitPush).toBeNull();
    const persisted = await request(app).get('/api/releases/v1');
    expect(persisted.status).toBe(200);
    expect(persisted.body.description).toBe('first cut');

    fs.writeFileSync(path.join(cwd, 'pages', 'b.md'), '# b');
    const pull = await request(app).patch('/api/releases/v1').send({ description: 'pulled', assignUnreleased: true });
    expect(pull.status).toBe(200);
    expect(pull.body.description).toBe('pulled');
    expect(pull.body.gitSync.status).toBe('error');
    expect(pull.body.gitSync.message).toContain('index.lock');
    expect(pull.body.gitSync.recovery).toMatchObject({ operation: 'pull' });
    expect((await request(app).get('/api/releases/v1')).body.description).toBe('pulled');
    // Nothing was committed.
    expect(git('log', '--all', '--format=%s').split('\n').filter(Boolean)).toEqual(['seed']);
  });

  it('[ac:ac-rest-patch-api-releases-nameorid-z-bod] errors: 409 RELEASE_FROZEN on a release that is not the latest, 409 RELEASE_NAME_CONFLICT on a rename collision', async () => {
    writeProjectConfig({ enabled: false });
    mount();
    await request(app).post('/api/releases').send({ name: 'v1', description: 'first' }).expect(201);
    await request(app).post('/api/releases').send({ name: 'v2', description: 'second' }).expect(201);

    const frozen = await request(app).patch('/api/releases/v1').send({ assignUnreleased: true });
    expect(frozen.status).toBe(409);
    expect(frozen.body.error.code).toBe('RELEASE_FROZEN');

    const conflict = await request(app).patch('/api/releases/v2').send({ name: 'v1' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('RELEASE_NAME_CONFLICT');
  });
});

/**
 * 2.1.55 (M17 w6cocvik / 18dkumzo, M28 sw1u84nn, dto `release` field
 * `gitPush`) — push on release: after the release commit, `POST /api/releases`
 * best-effort pushes the branch the commit landed on and answers the outcome in
 * `gitPush`, separate from `gitSync`. A failed push never fails the release.
 * `PATCH` (pull into the latest release) never pushes and carries no `gitPush`.
 * Real repositories: the project's working repo tracking a bare "remote".
 */
describe('POST /api/releases — push on release (M17 + M28, 2.1.55)', () => {
  let db: Database.Database;
  let base: string;
  let cwd: string;
  let bare: string;
  let app: express.Express;
  const git = (...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
  const remoteSha = (ref: string): string | null => {
    try {
      return execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`], { cwd: bare, encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };

  function setGitConfig(gitCfg: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(cwd, '.claude4spec', 'config.json'),
      JSON.stringify({
        $schemaVersion: 4,
        name: 'p',
        roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }],
        git: gitCfg,
      }),
    );
  }

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-rel-push-'));
    cwd = path.join(base, 'work');
    bare = path.join(base, 'remote.git');
    fs.mkdirSync(cwd);
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    setGitConfig({ enabled: true, syncPushOnRelease: true });
    fs.mkdirSync(path.join(cwd, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'pages', 'a.md'), '# a');
    git('add', '-A');
    git('commit', '-q', '-m', 'seed');
    git('remote', 'add', 'origin', bare);
    git('push', '-q', '-u', 'origin', 'main');
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
    releases.setGitService(gitService);
    app = express().use(express.json()).use('/api/releases', releasesRouter(releases, undefined, gitService)).use(errorHandler);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  const createRelease = (name = 'v1') => request(app).post('/api/releases').send({ name, description: 'first cut' });
  /** Unreleased work the release commit picks up. */
  const work = (file = 'b.md') => fs.writeFileSync(path.join(cwd, 'pages', file), `# ${file}`);

  /** A second clone pushes to the remote first: the project's next push is a non-fast-forward. */
  function remoteMovesAhead(): void {
    const other = path.join(base, 'other');
    execFileSync('git', ['clone', '-q', bare, other]);
    const inOther = (...args: string[]) => execFileSync('git', args, { cwd: other, encoding: 'utf8' });
    inOther('config', 'user.email', 'mate@example.com');
    inOther('config', 'user.name', 'Mate');
    fs.writeFileSync(path.join(other, 'mate.txt'), 'mate');
    inOther('add', 'mate.txt');
    inOther('commit', '-q', '-m', 'mate');
    inOther('push', '-q', 'origin', 'main');
  }

  it('[entity:release] createRelease answers the dto `release` with both additive git fields — gitSync (the commit) and gitPush (the push), separate; updateRelease carries no gitPush', async () => {
    work();
    const created = await createRelease();
    expect(created.status).toBe(201);
    expectReleasePayload(created.body);
    expect(created.body.gitSync).toMatchObject({ status: 'committed', branch: 'main', switched: false });
    expect(typeof created.body.gitSync.sha).toBe('string');
    expect(created.body.gitPush).toEqual({ status: 'pushed', branch: 'main' });

    work('c.md');
    const updated = await request(app).patch('/api/releases/v1').send({ assignUnreleased: true });
    expect(updated.status).toBe(200);
    expectReleasePayload(updated.body);
    expect('gitPush' in updated.body).toBe(false);
  });

  it('[ac:ac-przy-w-czonym-config-git-syncpushonpush] with config.git.syncPushOnRelease on and a committed release commit, createRelease best-effort pushes the branch the commit landed on', async () => {
    work();
    const res = await createRelease();
    expect(res.status).toBe(201);
    expect(res.body.gitSync.status).toBe('committed');
    expect(res.body.gitPush).toEqual({ status: 'pushed', branch: 'main' });
    // The remote branch now holds the release commit.
    expect(remoteSha('main')).toBe(git('rev-parse', 'main').trim());
    expect(remoteSha('main')).toBe(res.body.gitSync.sha);
  });

  it('[ac:ac-przy-config-git-syncpushonpush-false] with config.git.syncPushOnRelease=false createRelease answers gitPush: null — the commit lands, nothing is pushed', async () => {
    setGitConfig({ enabled: true, syncPushOnRelease: false });
    const remoteBefore = remoteSha('main');
    work();
    const res = await createRelease();
    expect(res.status).toBe(201);
    expect(res.body.gitSync.status).toBe('committed');
    expect(res.body).toHaveProperty('gitPush', null);
    expect(remoteSha('main')).toBe(remoteBefore);
  });

  it('[ac:ac-przy-config-git-enabled-false-creater] with config.git.enabled=false createRelease answers gitPush: null — whatever the push toggle says', async () => {
    setGitConfig({ enabled: false, syncPushOnRelease: true });
    const remoteBefore = remoteSha('main');
    work();
    const res = await createRelease();
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('gitSync', null);
    expect(res.body).toHaveProperty('gitPush', null);
    expect(remoteSha('main')).toBe(remoteBefore);
  });

  it('[ac:ac-przy-gitsync-status-innym-niz-committ] with gitSync other than committed createRelease runs no git push and answers gitPush: null — nothing-to-commit, and an error of the commit', async () => {
    // HEAD ahead of the remote: a push, had one run, would move origin/main.
    fs.writeFileSync(path.join(cwd, 'seed.txt'), 'local');
    git('add', 'seed.txt');
    git('commit', '-q', '-m', 'local only');
    const remoteBefore = remoteSha('main');

    // Nothing new to commit — the config file is committed with the seed.
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', 'clean');
    const clean = await createRelease('v1');
    expect(clean.status).toBe(201);
    expect(clean.body.gitSync).toEqual({ status: 'nothing-to-commit' });
    expect(clean.body).toHaveProperty('gitPush', null);

    // The commit ends in an error (a refusing pre-commit hook).
    const hooks = path.join(base, 'hooks');
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    git('config', 'core.hooksPath', hooks);
    work();
    const failed = await createRelease('v2');
    expect(failed.status).toBe(201);
    expect(failed.body.gitSync.status).toBe('error');
    expect(failed.body).toHaveProperty('gitPush', null);

    expect(remoteSha('main')).toBe(remoteBefore);
  });

  it('[ac:ac-response-createrelease-oraz-release-push] gitSync of createRelease with status committed carries the additive branch (where the commit landed) and switched (whether HEAD moved)', async () => {
    setGitConfig({ enabled: true });
    work();
    const current = await createRelease('v1');
    expect(current.body.gitSync).toMatchObject({ status: 'committed', branch: 'main', switched: false });

    git('branch', 'release-target');
    setGitConfig({ enabled: true, commitTarget: { mode: 'named', branch: 'release-target' }, switchAfterRelease: true });
    work('c.md');
    const named = await createRelease('v2');
    expect(named.body.gitSync).toMatchObject({ status: 'committed', branch: 'release-target', switched: true });
    expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('release-target');
  });

  it('[ac:ac-push-bez-upstream-przy-bledzie-sie] push with no upstream, on a network error and on a non-fast-forward answers gitPush { status: error, message } — best-effort: the release stands untouched each time', async () => {
    const expectReleaseStands = async (name: string, res: Awaited<ReturnType<typeof createRelease>>): Promise<void> => {
      expect(res.status).toBe(201);
      expect(res.body.name).toBe(name);
      expect(res.body.gitSync.status).toBe('committed');
      expect(res.body.gitPush.status).toBe('error');
      expect(typeof res.body.gitPush.message).toBe('string');
      expect(res.body.gitPush.message).not.toBe('');
      const persisted = await request(app).get(`/api/releases/${name}`);
      expect(persisted.status).toBe(200);
      expect(persisted.body.name).toBe(name);
    };

    // No upstream: the branch tracks nothing.
    git('branch', '--unset-upstream');
    work('b.md');
    await expectReleaseStands('v1', await createRelease('v1'));

    // A network error: the remote is unreachable.
    git('branch', '--set-upstream-to=origin/main');
    git('remote', 'set-url', 'origin', path.join(base, 'does-not-exist.git'));
    work('c.md');
    await expectReleaseStands('v2', await createRelease('v2'));

    // A non-fast-forward rejection.
    git('remote', 'set-url', 'origin', bare);
    remoteMovesAhead();
    work('d.md');
    await expectReleaseStands('v3', await createRelease('v3'));
  });

  it('[ac:ac-konflikt-odrzucenie-push-przez-remote] a conflicting push rejected by the remote (non-fast-forward) answers gitPush { status: error, message }, and creating the release still succeeds', async () => {
    remoteMovesAhead();
    const remoteBefore = remoteSha('main');
    work();
    const res = await createRelease();
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('v1');
    expect(res.body.gitSync.status).toBe('committed');
    expect(res.body.gitPush.status).toBe('error');
    expect(res.body.gitPush.message).toMatch(/rejected/);
    expect(remoteSha('main')).toBe(remoteBefore);
    expect((await request(app).get('/api/releases/v1')).status).toBe(200);
  });

  it('[ac:ac-push-wydania-odrzucony-przez-remote-j] a git push after the release rejected as non-fast-forward answers recovery.kind non-fast-forward in gitPush', async () => {
    remoteMovesAhead();
    work();
    const res = await createRelease();
    expect(res.status).toBe(201);
    expect(res.body.gitPush.status).toBe('error');
    expect(res.body.gitPush.recovery.operation).toBe('push');
    expect(res.body.gitPush.recovery.kind).toBe('non-fast-forward');
    // The commit result is separate and untouched by the push.
    expect(res.body.gitSync.status).toBe('committed');
    expect(res.body.gitSync.recovery).toBeUndefined();
  });

  it('[ac:ac-wariant-error-gitpushresult-niesie-w] the error variant of GitPushResult carries, in gitPush of the createRelease answer, recovery with operation push, reason, gitStderr and intentPrompt', async () => {
    git('remote', 'set-url', 'origin', path.join(base, 'does-not-exist.git'));
    work();
    const res = await createRelease();
    expect(res.status).toBe(201);
    const { gitPush } = res.body as { gitPush: Record<string, unknown> };
    expect(gitPush.status).toBe('error');
    expect(gitPush.branch).toBe('main');
    const recovery = gitPush.recovery as Record<string, unknown>;
    expect(recovery.operation).toBe('push');
    expect(typeof recovery.reason).toBe('string');
    expect(recovery.reason).not.toBe('');
    expect(typeof recovery.gitStderr).toBe('string');
    expect(recovery.gitStderr).not.toBe('');
    expect(typeof recovery.intentPrompt).toBe('string');
    expect(recovery.intentPrompt).toContain(recovery.gitStderr as string);
    expect(recovery.kind).toBeUndefined();
  });

  it('[ac:ac-updaterelease-z-assignunreleased-nie] updateRelease with assignUnreleased does not push — the answer carries no gitPush field and the pull commit stays local', async () => {
    work();
    await createRelease().expect(201);
    const remoteAfterCreate = remoteSha('main');

    work('c.md');
    const pull = await request(app).patch('/api/releases/v1').send({ assignUnreleased: true });
    expect(pull.status).toBe(200);
    expect(pull.body.gitSync).toMatchObject({ status: 'committed' });
    expect(git('log', '-1', '--format=%s').trim()).toBe('Pull to v1');
    expect('gitPush' in pull.body).toBe(false);
    expect(remoteSha('main')).toBe(remoteAfterCreate);
    expect(remoteSha('main')).not.toBe(git('rev-parse', 'main').trim());
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

  // 2.1.55 — the record no longer contrasts the route with a portable export:
  // the bundle archive is gone, so the snapshot is read from the version
  // tables only and carries the plain SpecSnapshot shape, nothing archive-like.
  it('[entity:get-api-releases-nameorid-snapshot] GET /api/releases/:name/snapshot answers the raw SpecSnapshot by default, { data: release_show } under view=operation, 400 for an operation parameter without the view, 404 for a literal or unknown name', async () => {
    const raw = await request(app).get('/api/releases/v3/snapshot');
    expect(raw.status).toBe(200);
    // spec-snapshot: exactly the four version-table fields — no envelope, no manifest/bundle field.
    expect(Object.keys(raw.body).sort()).toEqual(['entities', 'pages', 'release', 'serializer_versions']);
    expect(raw.body.release.name).toBe('v3');
    expect(raw.body).toEqual(JSON.parse(JSON.stringify(releases.getReleaseSnapshot(releases.resolveReleaseId('v3')))));
    for (const field of ['data', 'bundleSchemaVersion', 'c4sVersion', 'roots', 'manifest', 'sha256', 'tarGzPath']) {
      expect(raw.body).not.toHaveProperty(field);
    }

    // mcp-spec-snapshot: the operation payload under `data`, windowed by the operation's parameters.
    const op = await request(app).get('/api/releases/v3/snapshot?view=operation&include=entities&include=pages&limit=2&offset=0');
    expect(op.status).toBe(200);
    expect(op.body.data).toEqual(
      releaseShowOperation(
        { releaseService: releases, roots: () => ROOTS },
        { releaseName: 'v3', include: ['entities', 'pages'], limit: 2, offset: 0 },
      ),
    );

    for (const stray of ['limit=2', 'offset=1', 'include=pages', 'entityTypes=adr']) {
      const res = await request(app).get(`/api/releases/v3/snapshot?${stray}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ARGUMENT');
      expect(JSON.stringify(res.body.error)).toContain('view=operation');
    }

    for (const name of ['current', 'nope']) {
      const res = await request(app).get(`/api/releases/${name}/snapshot`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('RELEASE_NOT_FOUND');
    }
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

  it('[2.1.23] a release carrying a reserved name is listed, but POST /api/releases/initial/restore is still 404', async () => {
    db.prepare(`INSERT INTO spec_release (name, slug, description, created_by, created_at) VALUES ('initial', 'initial', 'carried over', 'user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run();
    const list = await request(app).get('/api/releases');
    expect(list.status).toBe(200);
    expect(list.body.releases.map((r: { name: string }) => r.name)).toContain('initial');
    const restore = await request(app).post('/api/releases/initial/restore').send({ scope: 'spec' });
    expect(restore.status).toBe(404);
    expect(restore.body.error.code).toBe('RELEASE_NOT_FOUND');
  });

  it('[2.1.23] GET /api/releases without view answers the list under `releases`', async () => {
    const res = await request(app).get('/api/releases');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeUndefined();
    expect(res.body.releases).toHaveLength(7);
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

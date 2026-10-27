/**
 * 2.1.47 (M17) — accepting a shadow, `POST /api/shadow-accept` (endpoint
 * `post-api-shadow-accept`, dto `shadow-accept-request`, spec-operation
 * `accept-shadow`): `ReleaseService.acceptShadow` → `acceptShadow`
 * (`release-accept-shadow.ts`) over the M28 merge primitives, the acceptance
 * variant of `createRelease` and the release mutex.
 *
 * Everything runs against a real temporary repository and a real SQLite DB
 * (migrations, `file_version` / `entity_version` / `spec_release`): the master
 * on `main`, a shadow as `refs/runs/run-1/spec` grown from an older master
 * commit. The file-watch runtime of the project is stood in for by the real
 * page capture (`FileVersionCapture`, as the agent's write) plus an in-memory
 * entity index the chain refreshes from disk — the two reactions the
 * acceptance's in-band chain must drive. Failures are injected (a throwing
 * chain step, a throwing release-file write, a failing pre-commit hook, a
 * stubbed abort), never taken from the host. The trial merge's git version is
 * injected, so nothing depends on the host's git being ≥ 2.38.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { diffEntity } from '../serialization/snapshot.js';
import type { SnapshotData } from '../serialization/types.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { SelfWriteSuppressor } from '../fs/sources.js';
import type { WatchEventKind } from '../fs/watcher.js';
import { EntityStore } from '../services/entity-store.js';
import { FileSerializer } from '../services/file-serializer.js';
import { FileVersionService } from '../services/file-version.js';
import { FileVersionCapture } from '../services/file-version-capture.js';
import { GitService } from '../services/git.js';
import type { MarkdownFileStore } from '../services/markdown-file-store.js';
import type { PagesService } from '../services/pages.js';
import { ReleaseService } from '../services/release.js';
import { ReleaseFileStore } from '../services/release-store.js';
import type { TagsService } from '../services/tags.js';
import { VersionService } from '../services/versions.js';
import type { ShadowAcceptRequest } from '../../shared/entities.js';
import type { WsEvent } from '../../shared/types.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import { errorHandler } from './errors.js';
import { gitRouter } from './git.js';
import { releasesRouter } from './releases.js';
import { shadowAcceptRouter } from './shadow-accept.js';

const pexec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd });
  return stdout;
}

const host = {
  getEntity: () => null,
  getAvailable: () => true,
  listEntities: () => [],
  snapshot: (_type: string, raw: unknown) => raw as SnapshotData,
  diff: (type: string, a: SnapshotData, b: SnapshotData) => diffEntity({ getEntity: () => null }, type, a, b),
} as unknown as PluginHost;

const STAMP = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', payloadVersion: 1 };
const entityFile = (payload: Record<string, unknown>): string => JSON.stringify({ ...payload, ...STAMP }, null, 2) + '\n';

type GitVersionHolder = { gitVersion(): Promise<string | null> };
type ErrorBody = {
  error: { code: string; message: string; details?: string[]; recovery?: { kind?: string }; gitSync?: { status?: string } };
};

/** Files of the registry roots the scenarios touch — the working-tree state a rollback must restore. */
const TRACKED = [
  'pages/a.md',
  'pages/b.md',
  'pages/c.md',
  '.claude4spec/entities/endpoint/e1.json',
  '.claude4spec/entities/endpoint/e2.json',
  '.claude4spec/entities/endpoint/e3.json',
  '.claude4spec/releases/v0.json',
  '.claude4spec/releases/v1.json',
];

describe('M17 shadow acceptance — POST /api/shadow-accept (2.1.47)', () => {
  let dir: string;
  let pagesDir: string;
  let entitiesDir: string;
  let db: Database.Database;
  let gitService: GitService;
  let releaseService: ReleaseService;
  let fileVersions: FileVersionService;
  let versions: VersionService;
  let app: express.Express;
  /** The entity index (M29) as the chain keeps it: `<type>/<slug>` → row. */
  let index: Map<string, Record<string, unknown>>;
  let broadcasts: WsEvent[];
  let turnActive: boolean;
  /** Fault injection: runs first in every in-band chain. */
  let chainHook: ((abs: string, event: WatchEventKind) => Promise<void> | void) | null;
  let suppressions: Array<{ paths: string[]; released: boolean }>;
  let c1: string;
  let n = 0;

  const write = (rel: string, content: string): void => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  const read = (rel: string): string | null =>
    fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), 'utf8') : null;
  const commitAll = async (message: string): Promise<string> => {
    await git(['add', '-A'], dir);
    await git(['commit', '-q', '--allow-empty', '-m', message], dir);
    return (await git(['rev-parse', 'HEAD'], dir)).trim();
  };
  const head = async (): Promise<string> => (await git(['rev-parse', 'HEAD'], dir)).trim();
  /** A `refs/runs/<id>` ref: `edit()` on top of `from`, committed; HEAD comes back to `main`. */
  const shadow = async (id: string, from: string, edit: () => void): Promise<string> => {
    const tmp = `tmp-shadow-${++n}`;
    await git(['checkout', '-q', '-b', tmp, from], dir);
    edit();
    const tip = await commitAll(`Shadow turn ${id}`);
    await git(['update-ref', `refs/runs/${id}`, tip], dir);
    await git(['checkout', '-q', 'main'], dir);
    await git(['branch', '-q', '-D', tmp], dir);
    return tip;
  };
  const setConfig = (gitCfg: Record<string, unknown>): void =>
    write('.claude4spec/config.json', JSON.stringify({ $schemaVersion: 4, name: 'test', git: gitCfg }, null, 2));

  /** The repository as a value: HEAD, the index's entries, refs, status, the roots' files, an open merge. */
  const repoState = async () => ({
    head: await head(),
    symbolicHead: (await git(['symbolic-ref', '-q', 'HEAD'], dir).catch(() => '')).trim(),
    index: await git(['ls-files', '--stage'], dir),
    refs: await git(['for-each-ref', '--format=%(refname) %(objectname)'], dir),
    status: await git(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'], dir),
    worktree: Object.fromEntries(TRACKED.map((f) => [f, read(f)])),
    mergeInProgress: fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD')),
  });
  /** The version log and the release cache as values. */
  const dbState = () => ({
    fileVersions: db.prepare(`SELECT id, rootId, path, version, op, changed_by, release_id FROM file_version ORDER BY id`).all(),
    entityVersions: db
      .prepare(`SELECT entity_type, entity_slug, version, op, changed_by, release_id FROM entity_version ORDER BY rowid`)
      .all(),
    releases: db.prepare(`SELECT name, slug FROM spec_release ORDER BY id`).all(),
  });

  /** The base scenario: the shadow edits a.md, adds c.md, edits e1, deletes e2, creates e3; the master then edits b.md. */
  let tip: string;
  let headSha: string;
  const baseScenario = async (): Promise<void> => {
    tip = await shadow('run-1/spec', c1, () => {
      write('pages/a.md', '# A\n\nA shadow\n');
      write('pages/c.md', '# C\n\nC shadow\n');
      write('.claude4spec/entities/endpoint/e1.json', entityFile({ slug: 'e1', summary: 'v2' }));
      fs.rmSync(path.join(dir, '.claude4spec/entities/endpoint/e2.json'));
      write('.claude4spec/entities/endpoint/e3.json', entityFile({ slug: 'e3', summary: 'fresh' }));
    });
    write('pages/b.md', '# B\n\nB master\n');
    headSha = await commitAll('C2');
  };

  const accept = (over: Partial<ShadowAcceptRequest> & Record<string, unknown> = {}) =>
    request(app)
      .post('/api/shadow-accept')
      .send({ ref: 'run-1/spec', name: 'v1', description: 'Accept run 1', expectedTipSha: tip, expectedHeadSha: headSha, ...over });

  const unreleasedPageRows = (rel: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM file_version WHERE path = ? AND release_id IS NULL`).get(rel) as { n: number }).n;
  const pageRows = (rel: string): Array<{ op: string; changed_by: string; data: string; release_id: number | null }> =>
    db.prepare(`SELECT op, changed_by, data, release_id FROM file_version WHERE path = ? ORDER BY id`).all(rel) as never;
  const entityRows = (slug: string): Array<{ op: string; changed_by: string; release_id: number | null }> =>
    db.prepare(`SELECT op, changed_by, release_id FROM entity_version WHERE entity_slug = ? ORDER BY version`).all(slug) as never;
  const releaseIdOf = (name: string): number =>
    (db.prepare(`SELECT id FROM spec_release WHERE name = ?`).get(name) as { id: number }).id;

  beforeEach(async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-shadow-accept-')));
    pagesDir = path.join(dir, 'pages');
    entitiesDir = path.join(dir, '.claude4spec', 'entities');
    await git(['init', '-q', '-b', 'main'], dir);
    await git(['config', 'user.email', 'test@example.com'], dir);
    await git(['config', 'user.name', 'Test'], dir);
    setConfig({ enabled: true });

    index = new Map();
    broadcasts = [];
    turnActive = false;
    chainHook = null;
    suppressions = [];

    db = new Database(':memory:');
    runMigrations(db);
    const serializer = new FileSerializer({ root: pagesDir } as unknown as MarkdownFileStore);
    fileVersions = new FileVersionService(db, serializer);
    versions = new VersionService(db);
    const rawReader = {
      hasTable: () => true,
      getEntity: (type: string, slug: string) => index.get(`${type}/${slug}`) ?? null,
    } as unknown as RawEntityReader;
    const ws = { broadcast: (e: WsEvent) => broadcasts.push(e) } as unknown as WsEmitter;
    gitService = new GitService(dir, [pagesDir], () => turnActive, ws);
    const releaseStore = new ReleaseFileStore(dir, '.claude4spec/releases', { suppress: () => {} } as SelfWriteSuppressor);
    releaseStore.ensureRoot();
    // 2.1.49 (m17ui001): the store announces its writes in the `releases` root (M49).
    releaseStore.ws = ws;
    releaseService = new ReleaseService(
      db,
      host,
      versions,
      fileVersions,
      serializer,
      rawReader,
      {} as unknown as TagsService,
      {} as unknown as PagesService,
      () => null,
      dir,
      ['pages'],
      [pagesDir],
    );
    releaseService.setReleaseStore(releaseStore);
    releaseService.setGitService(gitService);
    releaseService.setReleaseFlagRootDirs([pagesDir, entitiesDir]);
    releaseService.setEntityStore(
      new EntityStore(dir, '.claude4spec/entities', { suppress: () => {} } as SelfWriteSuppressor, rawReader, host),
    );
    const capture = new FileVersionCapture(fileVersions, new Map([['pages', serializer]]), () => 'agent');
    releaseService.setAcceptShadowRuntime({
      suppressOperation: (paths) => {
        const s = { paths: [...paths], released: false };
        suppressions.push(s);
        return { release: () => void (s.released = true) };
      },
      runChain: async (abs, event) => {
        await chainHook?.(abs, event);
        const relPage = path.relative(pagesDir, abs);
        if (!relPage.startsWith('..')) {
          const input = { rootId: 'pages' };
          if (event === 'unlink') await capture.onUnlink('context:p', 'pages:pages', relPage, 'server', input);
          else await capture.onChange('context:p', 'pages:pages', relPage, 'server', input);
          return;
        }
        const m = /^([a-z0-9-]+)\/([^/]+)\.json$/.exec(path.relative(entitiesDir, abs).split(path.sep).join('/'));
        if (!m) return;
        const key = `${m[1]}/${m[2]}`;
        if (event === 'unlink') index.delete(key);
        else index.set(key, JSON.parse(fs.readFileSync(abs, 'utf8')) as Record<string, unknown>);
      },
      pageKeys: (abs) => {
        const rel = path.relative(pagesDir, abs);
        return rel.startsWith('..') ? [] : [{ rootId: 'pages', relPath: rel }];
      },
    });

    app = express();
    app.use(express.json());
    app.use('/api/releases', releasesRouter(releaseService, ws, gitService));
    app.use('/api/shadow-accept', shadowAcceptRouter(releaseService, ws));
    app.use('/api/git', gitRouter(gitService, {}));
    app.use(errorHandler);

    vi.spyOn(GitService.prototype as unknown as GitVersionHolder, 'gitVersion').mockResolvedValue('git version 2.38.0');

    // C1 — the state the app knows: pages and entities captured, released as `v0`, committed.
    write('pages/a.md', '# A\n\nA one\n');
    write('pages/b.md', '# B\n\nB one\n');
    write('.claude4spec/entities/endpoint/e1.json', entityFile({ slug: 'e1', summary: 'v1' }));
    write('.claude4spec/entities/endpoint/e2.json', entityFile({ slug: 'e2', summary: 'keep' }));
    for (const rel of ['a.md', 'b.md']) await fileVersions.recordVersion(rel, 'create', 'user', undefined, serializer, 'pages');
    for (const slug of ['e1', 'e2']) {
      const row = JSON.parse(read(`.claude4spec/entities/endpoint/${slug}.json`)!) as Record<string, unknown>;
      index.set(`endpoint/${slug}`, row);
      versions.createVersion('endpoint', slug, row, 'user', 'Created', 'create', '1');
    }
    releaseService.createRelease({ name: 'v0', description: 'Baseline' }, 'user');
    c1 = await commitAll('C1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ─── success ────────────────────────────────────────────────────────────────

  it('[entity:post-api-shadow-accept] [ac:ac-post-api-shadow-accept-z-poprawna-naz] POST /api/shadow-accept with a valid name, description and the current SHAs answers 201 with a new release (acceptedShadow set, gitSync committed) that GET /api/releases lists', async () => {
    await baseScenario();
    const res = await accept();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'v1',
      description: 'Accept run 1',
      createdBy: 'user',
      acceptedShadow: { id: 'run-1/spec', tipSha: tip },
      gitSync: { status: 'committed', branch: 'main', switched: false },
      gitPush: null,
    });
    expect(typeof res.body.id).toBe('number');
    // The linked response dto `release`: its fields, `acceptedShadow` set, plus `gitSync` and `gitPush`.
    expect(Object.keys(res.body).sort()).toEqual(
      ['acceptedShadow', 'countBreakdown', 'createdAt', 'createdBy', 'description', 'gitPush', 'gitSync', 'id', 'name'].sort(),
    );
    expect(res.body.countBreakdown).toEqual(expect.objectContaining({ pages: expect.any(Number), total: expect.any(Number) }));
    const list = await request(app).get('/api/releases');
    expect(list.body.releases.map((r: { name: string }) => r.name)).toEqual(['v1', 'v0']);
    expect(broadcasts).toContainEqual({ kind: 'release:created', releaseId: res.body.id, name: 'v1' });
  });

  it('[ac:ac-przyjecie-cienia-nie-wypycha-odpowied] accepting a shadow does not push — even with push on release switched on, the answer carries gitPush: null and the remote branch stays where it was', async () => {
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-shadow-accept-remote-')));
    try {
      await git(['init', '-q', '--bare', '-b', 'main', bare], bare);
      // Push on release switched on, committed on the master before the shadow scenario.
      setConfig({ enabled: true, syncPushOnRelease: true });
      await commitAll('push on release');
      await baseScenario();
      await git(['remote', 'add', 'origin', bare], dir);
      await git(['push', '-q', '-u', 'origin', 'main'], dir);
      const remoteBefore = (await git(['rev-parse', 'main'], bare)).trim();
      expect(remoteBefore).toBe(headSha);

      const res = await accept();
      expect(res.status).toBe(201);
      expect(res.body.gitSync).toMatchObject({ status: 'committed', branch: 'main' });
      expect(res.body).toHaveProperty('gitPush', null);
      // The merge commit landed locally only.
      expect(await head()).not.toBe(headSha);
      expect((await git(['rev-parse', 'main'], bare)).trim()).toBe(remoteBefore);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it('[section:m17ui001] a successful acceptance announces its release file to open tabs: file:changed { rootId: releases, event: change, origin: server } next to release:created', async () => {
    await baseScenario();
    broadcasts.length = 0;
    const res = await accept();
    expect(res.status).toBe(201);
    expect(broadcasts).toContainEqual({ kind: 'release:created', releaseId: res.body.id, name: 'v1' });
    expect(broadcasts).toContainEqual({ kind: 'file:changed', event: 'change', path: 'v1.json', rootId: 'releases', origin: 'server' });
  });

  it('[entity:shadow-accept-request] the body is ref + name + description + expectedTipSha + expectedHeadSha, all required strings; a missing one is 400 VALIDATION before the repository is touched, and an acceptedShadow in the body is never taken from the caller', async () => {
    await baseScenario();
    const before = await repoState();
    for (const key of ['ref', 'expectedTipSha', 'expectedHeadSha'] as const) {
      const res = await accept({ [key]: undefined });
      expect(res.status, key).toBe(400);
      expect((res.body as ErrorBody).error.code, key).toBe('VALIDATION');
      const empty = await accept({ [key]: '' });
      expect((empty.body as ErrorBody).error.code, key).toBe('VALIDATION');
    }
    expect((await accept({ name: '  ' })).body.error.code).toBe('VALIDATION');
    expect((await accept({ description: '' })).body.error.code).toBe('RELEASE_DESCRIPTION_REQUIRED');
    expect((await accept({ description: 'x'.repeat(501) })).body.error.code).toBe('RELEASE_DESCRIPTION_TOO_LONG');
    expect((await accept({ name: 'current' })).body.error.code).toBe('RELEASE_NAME_RESERVED');
    expect(await repoState()).toEqual(before);
    expect(suppressions).toEqual([]);

    const ok = await accept({ acceptedShadow: { id: 'forged', tipSha: 'f'.repeat(40) } });
    expect(ok.status).toBe(201);
    expect(ok.body.acceptedShadow).toEqual({ id: 'run-1/spec', tipSha: tip });
  });

  it('[ac:ac-drugim-rodzicem-commita-przyjecia-jes] the second parent of the acceptance commit is the tip SHA from the request', async () => {
    await baseScenario();
    expect((await accept()).status).toBe(201);
    expect((await git(['rev-parse', 'HEAD^2'], dir)).trim()).toBe(tip);
  });

  it('[ac:ac-po-udanym-przyjeciu-head-wskazuje-com] after a successful acceptance HEAD points at a commit with two parents — the previous HEAD first', async () => {
    await baseScenario();
    expect((await accept()).status).toBe(201);
    const parents = (await git(['rev-list', '--parents', '-n', '1', 'HEAD'], dir)).trim().split(' ').slice(1);
    expect(parents).toEqual([headSha, tip]);
    expect((await git(['symbolic-ref', 'HEAD'], dir)).trim()).toBe('refs/heads/main');
    expect(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))).toBe(false);
  });

  it('[ac:ac-po-udanym-przyjeciu-drzewo-robocze-ni] after a successful acceptance the working tree has no changes in the registry roots', async () => {
    await baseScenario();
    expect((await accept()).status).toBe(201);
    expect(await git(['status', '--porcelain', '--untracked-files=all', '--', 'pages', '.claude4spec/entities', '.claude4spec/releases'], dir)).toBe('');
  });

  it('[ac:ac-po-udanym-przyjeciu-get-api-git-shado] after a successful acceptance GET /api/git/shadows no longer lists the accepted shadow', async () => {
    await baseScenario();
    const before = await request(app).get('/api/git/shadows');
    expect(before.body.shadows.map((s: { id: string }) => s.id)).toEqual(['run-1/spec']);
    expect((await accept()).status).toBe(201);
    const after = await request(app).get('/api/git/shadows');
    expect(after.status).toBe(200);
    expect(after.body.shadows).toEqual([]);
    // The ref itself is not removed — it is an ancestor of HEAD now.
    expect((await git(['rev-parse', 'refs/runs/run-1/spec'], dir)).trim()).toBe(tip);
  });

  it('[ac:ac-po-udanym-przyjeciu-ostatnia-wersja-s] after a successful acceptance the latest version of a page the shadow changed has the content of the acceptance commit', async () => {
    await baseScenario();
    expect((await accept()).status).toBe(201);
    for (const rel of ['a.md', 'c.md']) {
      const rows = pageRows(rel);
      const latest = JSON.parse(rows[rows.length - 1]!.data) as { content: string };
      expect(latest.content, rel).toBe(await git(['show', `HEAD:pages/${rel}`], dir));
    }
  });

  it('[ac:ac-udane-przyjecie-dodaje-dokladnie-jede] a successful acceptance adds exactly one file_version row per page the shadow changed, written as the agent and released with the acceptance', async () => {
    await baseScenario();
    const before = { a: pageRows('a.md').length, b: pageRows('b.md').length, c: pageRows('c.md').length };
    const res = await accept();
    expect(res.status).toBe(201);
    expect(pageRows('a.md')).toHaveLength(before.a + 1);
    expect(pageRows('c.md')).toHaveLength(before.c + 1);
    // b.md is the master's own change, not the shadow's — the acceptance captures nothing for it.
    expect(pageRows('b.md')).toHaveLength(before.b);
    for (const rel of ['a.md', 'c.md']) {
      const last = pageRows(rel).at(-1)!;
      expect(last.changed_by, rel).toBe('agent');
      expect(last.release_id, rel).toBe(res.body.id);
    }
  });

  it('[ac:ac-wersja-encji-zmienionej-przez-cien-w] the version of an entity the shadow changed in the acceptance release has changed_by = agent', async () => {
    await baseScenario();
    const res = await accept();
    expect(res.status).toBe(201);
    const released = entityRows('e1').filter((r) => r.release_id === res.body.id);
    expect(released).toEqual([{ op: 'update', changed_by: 'agent', release_id: res.body.id }]);
  });

  it('[ac:ac-count-breakdown-wydania-przyjmujacego] the count_breakdown of the acceptance release counts the entities the shadow changed (updated and created)', async () => {
    await baseScenario();
    const res = await accept();
    expect(res.status).toBe(201);
    expect(entityRows('e1').at(-1)).toEqual({ op: 'update', changed_by: 'agent', release_id: res.body.id });
    expect(entityRows('e3')).toEqual([{ op: 'create', changed_by: 'agent', release_id: res.body.id }]);
    // e1 update + e3 create + e2 delete; pages: a.md + c.md.
    expect(res.body.countBreakdown).toEqual({ entities: { endpoint: 3 }, pages: 2, total: 5 });
  });

  it('[ac:ac-count-breakdown-wydania-przyjmujacego-2] the count_breakdown of the acceptance release counts the entities the shadow deleted', async () => {
    await baseScenario();
    const res = await accept();
    expect(res.status).toBe(201);
    expect(entityRows('e2').at(-1)).toEqual({ op: 'delete', changed_by: 'agent', release_id: res.body.id });
    const v1 = await request(app).get('/api/releases/v1');
    expect(v1.body.countBreakdown.entities.endpoint).toBe(3);
    expect(index.has('endpoint/e2')).toBe(false);
  });

  it('[ac:ac-plik-wydania-przyjmujacego-cien-niesi] the file of the acceptance release carries acceptedShadow.id equal to the shadow id — on disk and in the acceptance commit', async () => {
    await baseScenario();
    expect((await accept()).status).toBe(201);
    const onDisk = JSON.parse(read('.claude4spec/releases/v1.json')!) as { acceptedShadow: { id: string } };
    const committed = JSON.parse(await git(['show', 'HEAD:.claude4spec/releases/v1.json'], dir)) as { acceptedShadow: { id: string } };
    expect(onDisk.acceptedShadow.id).toBe('run-1/spec');
    expect(committed.acceptedShadow.id).toBe('run-1/spec');
  });

  it('[ac:ac-plik-wydania-przyjmujacego-cien-niesi-2] the file of the acceptance release carries acceptedShadow.tipSha equal to the tip SHA, and the release dto carries it as its accepted shadow', async () => {
    await baseScenario();
    const res = await accept();
    expect(res.status).toBe(201);
    const onDisk = JSON.parse(read('.claude4spec/releases/v1.json')!) as { acceptedShadow: { tipSha: string } };
    expect(onDisk.acceptedShadow.tipSha).toBe(tip);
    // The release dto (the acceptance answer and GET /api/releases/:name) reads the same tip SHA.
    expect(res.body.acceptedShadow).toEqual({ id: 'run-1/spec', tipSha: tip });
    expect((await request(app).get('/api/releases/v1')).body.acceptedShadow).toEqual({ id: 'run-1/spec', tipSha: tip });
    // The plain release keeps no such key.
    expect(JSON.parse(read('.claude4spec/releases/v0.json')!)).not.toHaveProperty('acceptedShadow');
  });

  it('[ac:ac-resolvereleasecommit-znajduje-plik-wy] resolveReleaseCommit finds the release file introduced in the acceptance merge commit', async () => {
    await baseScenario();
    expect((await accept()).status).toBe(201);
    const marker = await gitService.resolveReleaseCommit(path.join(dir, '.claude4spec/releases/v1.json'));
    expect(marker).toBe(await head());
  });

  it('[ac:ac-po-sync-merged-na-drugim-klonie-gdy-u] after sync() merged on a second clone whose upstream holds the acceptance commit, resolveReleaseCommit returns the acceptance commit', async () => {
    const origin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-shadow-accept-origin-')));
    const clone = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-shadow-accept-clone-')));
    try {
      await git(['init', '-q', '--bare', '-b', 'main'], origin);
      await baseScenario();
      await git(['remote', 'add', 'origin', origin], dir);
      await git(['push', '-q', '-u', 'origin', 'main'], dir);
      await git(['clone', '-q', origin, clone], dir);
      await git(['config', 'user.email', 'second@example.com'], clone);
      await git(['config', 'user.name', 'Second'], clone);
      // The second clone moves on locally, so its sync has to merge.
      fs.writeFileSync(path.join(clone, 'pages', 'b.md'), '# B\n\nB second clone\n');
      await git(['commit', '-q', '-am', 'second clone edit'], clone);

      expect((await accept()).status).toBe(201);
      const acceptance = await head();
      await git(['push', '-q', 'origin', 'main'], dir);

      const second = new GitService(clone, [path.join(clone, 'pages')]);
      const synced = await second.sync();
      expect(synced.status).toBe('merged');
      expect(await second.resolveReleaseCommit(path.join(clone, '.claude4spec/releases/v1.json'))).toBe(acceptance);
    } finally {
      fs.rmSync(origin, { recursive: true, force: true });
      fs.rmSync(clone, { recursive: true, force: true });
    }
  });

  it('[ac:ac-przyjecie-cienia-bez-zmian-tworzy-now] accepting a shadow without changes creates a new release, and the merge commit carries the release file alone', async () => {
    const emptyTip = await shadow('run-2/spec', c1, () => {});
    headSha = await head();
    const res = await accept({ ref: 'run-2/spec', expectedTipSha: emptyTip, name: 'v1' });
    expect(res.status).toBe(201);
    expect(res.body.acceptedShadow).toEqual({ id: 'run-2/spec', tipSha: emptyTip });
    expect((await git(['rev-parse', 'HEAD^2'], dir)).trim()).toBe(emptyTip);
    expect((await git(['diff', '--name-only', 'HEAD^1', 'HEAD'], dir)).trim()).toBe('.claude4spec/releases/v1.json');
  });

  it('[ac:ac-nieudany-commit-wydania-przyjmujacego] a failed commit of the acceptance release answers 201 with gitSync.recovery.kind merge-open — the release exists, the merge stays open', async () => {
    await baseScenario();
    const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, '#!/bin/sh\necho "refused by hook" >&2\nexit 1\n', { mode: 0o755 });
    const res = await accept();
    expect(res.status).toBe(201);
    expect(res.body.gitSync.status).toBe('error');
    expect(res.body.gitSync.recovery.kind).toBe('merge-open');
    expect(res.body.acceptedShadow).toEqual({ id: 'run-1/spec', tipSha: tip });
    expect(releaseIdOf('v1')).toBe(res.body.id);
    expect(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(await head()).toBe(headSha);
    expect(broadcasts).toContainEqual({ kind: 'git:status-changed', headChanged: false });
  });

  // ─── refusals before the merge ──────────────────────────────────────────────

  /** A refusal leaves the repository, the version log and the release cache as they were, and issues no suppression. */
  const expectUntouched = async (res: { body: unknown }, code: string, before: Awaited<ReturnType<typeof repoState>>, dbBefore: ReturnType<typeof dbState>) => {
    expect((res.body as ErrorBody).error.code).toBe(code);
    expect(await repoState()).toEqual(before);
    expect(dbState()).toEqual(dbBefore);
  };

  it('[ac:ac-odlaczony-head-accept-no-branch] a detached HEAD → 409 ACCEPT_NO_BRANCH', async () => {
    await baseScenario();
    await git(['checkout', '-q', '--detach'], dir);
    const before = await repoState();
    const dbBefore = dbState();
    const res = await accept();
    expect(res.status).toBe(409);
    await expectUntouched(res, 'ACCEPT_NO_BRANCH', before, dbBefore);
  });

  it('[ac:ac-committarget-mode-named-accept-target] commitTarget.mode = named → 409 ACCEPT_TARGET_NOT_CURRENT', async () => {
    await baseScenario();
    setConfig({ enabled: true, commitTarget: { mode: 'named', branch: 'release' } });
    await commitAll('named target');
    headSha = await head();
    const before = await repoState();
    const dbBefore = dbState();
    const res = await accept();
    expect(res.status).toBe(409);
    await expectUntouched(res, 'ACCEPT_TARGET_NOT_CURRENT', before, dbBefore);
  });

  it('[ac:ac-expectedtipsha-rozny-od-biezacego-tip] expectedTipSha different from the current tip → 409 ACCEPT_STALE', async () => {
    await baseScenario();
    const before = await repoState();
    const dbBefore = dbState();
    const res = await accept({ expectedTipSha: c1 });
    expect(res.status).toBe(409);
    await expectUntouched(res, 'ACCEPT_STALE', before, dbBefore);
  });

  it('[ac:ac-expectedheadsha-rozny-od-biezacego-he] expectedHeadSha different from the current HEAD → 409 ACCEPT_STALE', async () => {
    await baseScenario();
    const before = await repoState();
    const dbBefore = dbState();
    const res = await accept({ expectedHeadSha: c1 });
    expect(res.status).toBe(409);
    await expectUntouched(res, 'ACCEPT_STALE', before, dbBefore);
  });

  it('[ac:ac-nowy-plik-niesledzony-w-korzeniu-reje] a new untracked file in a root of a kind with the release flag → 409 ACCEPT_DIRTY', async () => {
    await baseScenario();
    write('pages/new.md', '# New\n');
    const before = await repoState();
    const dbBefore = dbState();
    const res = await accept();
    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error.details).toEqual(['pages/new.md']);
    await expectUntouched(res, 'ACCEPT_DIRTY', before, dbBefore);
  });

  it('[ac:ac-zmodyfikowany-plik-sledzony-w-korzeni] a modified tracked file in a root of a kind with the release flag → 409 ACCEPT_DIRTY', async () => {
    await baseScenario();
    write('pages/b.md', '# B\n\nB edited, not committed\n');
    const before = await repoState();
    const dbBefore = dbState();
    const res = await accept();
    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error.details).toEqual(['pages/b.md']);
    await expectUntouched(res, 'ACCEPT_DIRTY', before, dbBefore);
  });

  it('[ac:ac-zastage-owany-plik-spoza-korzeni-reje] a staged file outside the registry roots → 409 ACCEPT_DIRTY', async () => {
    await baseScenario();
    write('notes.txt', 'someone else\n');
    await git(['add', 'notes.txt'], dir);
    const before = await repoState();
    const dbBefore = dbState();
    const res = await accept();
    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error.details).toEqual(['notes.txt']);
    await expectUntouched(res, 'ACCEPT_DIRTY', before, dbBefore);
  });

  it('[ac:ac-cien-zmieniajacy-plik-poza-korzeniami] a shadow changing a file outside the registry roots → 409 ACCEPT_OUTSIDE_SPEC', async () => {
    tip = await shadow('run-1/spec', c1, () => {
      write('pages/a.md', '# A\n\nA shadow\n');
      write('src/app.ts', 'export {};\n');
    });
    headSha = await head();
    const before = await repoState();
    const dbBefore = dbState();
    const res = await accept();
    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error.details).toEqual(['src/app.ts']);
    await expectUntouched(res, 'ACCEPT_OUTSIDE_SPEC', before, dbBefore);
  });

  it('[ac:ac-cien-dodajacy-plik-do-korzenia-releas] a shadow adding a file to the releases root → 409 ACCEPT_RELEASES_IN_SHADOW', async () => {
    tip = await shadow('run-1/spec', c1, () => {
      write('pages/a.md', '# A\n\nA shadow\n');
      write('.claude4spec/releases/smuggled.json', JSON.stringify({ name: 'smuggled' }) + '\n');
    });
    headSha = await head();
    const before = await repoState();
    const dbBefore = dbState();
    const res = await accept();
    expect(res.status).toBe(409);
    await expectUntouched(res, 'ACCEPT_RELEASES_IN_SHADOW', before, dbBefore);
  });

  it('[ac:ac-cien-modyfikujacy-istniejacy-plik-wyd] a shadow modifying an existing release file → 409 ACCEPT_RELEASES_IN_SHADOW', async () => {
    tip = await shadow('run-1/spec', c1, () => {
      const v0 = JSON.parse(read('.claude4spec/releases/v0.json')!) as Record<string, unknown>;
      write('.claude4spec/releases/v0.json', JSON.stringify({ ...v0, description: 'rewritten by a shadow' }, null, 2) + '\n');
    });
    headSha = await head();
    const before = await repoState();
    const dbBefore = dbState();
    const res = await accept();
    expect(res.status).toBe(409);
    await expectUntouched(res, 'ACCEPT_RELEASES_IN_SHADOW', before, dbBefore);
  });

  it('[ac:ac-cien-w-konflikcie-z-masterem-accept-c] a shadow conflicting with the master → 409 ACCEPT_CONFLICTS — from the trial merge, and from the real merge where the trial one is unavailable', async () => {
    tip = await shadow('run-1/spec', c1, () => write('pages/a.md', '# A\n\nA shadow\n'));
    write('pages/a.md', '# A\n\nA master\n');
    headSha = await commitAll('C2');
    const before = await repoState();
    const dbBefore = dbState();
    const res = await accept();
    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error.details).toEqual(['pages/a.md']);
    await expectUntouched(res, 'ACCEPT_CONFLICTS', before, dbBefore);

    // git < 2.38: no trial merge — the real merge conflicts and the primitive aborts it.
    vi.spyOn(GitService.prototype as unknown as GitVersionHolder, 'gitVersion').mockResolvedValue('git version 2.37.1');
    const real = await accept();
    expect(real.status).toBe(409);
    expect((real.body as ErrorBody).error.details).toEqual(['pages/a.md']);
    await expectUntouched(real, 'ACCEPT_CONFLICTS', before, dbBefore);
  });

  it('[ac:ac-przyjecie-w-trakcie-tury-agenta-accep] accepting while an agent turn runs → 409 ACCEPT_BUSY; so does a taken repository lock', async () => {
    await baseScenario();
    const before = await repoState();
    const dbBefore = dbState();
    turnActive = true;
    const res = await accept();
    expect(res.status).toBe(409);
    await expectUntouched(res, 'ACCEPT_BUSY', before, dbBefore);
    turnActive = false;

    // The lock held by another git operation: refused, not awaited.
    let free!: () => void;
    let taken!: () => void;
    const isTaken = new Promise<void>((resolve) => (taken = resolve));
    const holding = gitService.tryWithRepoLock(
      () =>
        new Promise<void>((resolve) => {
          free = resolve;
          taken();
        }),
    );
    await isTaken;
    const locked = await accept();
    expect(locked.status).toBe(409);
    await expectUntouched(locked, 'ACCEPT_BUSY', before, dbBefore);
    free();
    await holding;
    expect((await accept()).status).toBe(201);
  });

  it('[ac:ac-nazwa-zajeta-post-api-shadow-accept-z] a name already taken → POST /api/shadow-accept answers 409 RELEASE_NAME_CONFLICT', async () => {
    await baseScenario();
    const res = await accept({ name: 'v0' });
    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error.code).toBe('RELEASE_NAME_CONFLICT');
  });

  it('[ac:ac-odmowa-release-name-conflict-przy-prz] a RELEASE_NAME_CONFLICT refusal of the acceptance does not change HEAD', async () => {
    await baseScenario();
    const before = await repoState();
    const dbBefore = dbState();
    const res = await accept({ name: '  v0  ' });
    expect(res.status).toBe(409);
    await expectUntouched(res, 'RELEASE_NAME_CONFLICT', before, dbBefore);
    expect(await head()).toBe(headSha);
    expect(suppressions).toEqual([]);
  });

  it('[entity:accept-shadow] the guards refuse in the record\'s order, git off is GIT_UNAVAILABLE, an unknown shadow SHADOW_NOT_FOUND, and a repeated call after success is refused without a second release', async () => {
    await baseScenario();
    // No branch beats a stale SHA.
    await git(['checkout', '-q', '--detach'], dir);
    expect((await accept({ expectedTipSha: c1 })).body.error.code).toBe('ACCEPT_NO_BRANCH');
    await git(['checkout', '-q', 'main'], dir);
    // An unknown shadow comes before the SHA check.
    expect((await accept({ ref: 'nope/spec', expectedTipSha: c1 })).body.error.code).toBe('SHADOW_NOT_FOUND');
    // Stale beats dirty.
    write('pages/new.md', '# New\n');
    expect((await accept({ expectedHeadSha: c1 })).body.error.code).toBe('ACCEPT_STALE');
    fs.rmSync(path.join(dir, 'pages/new.md'));
    // Git off.
    setConfig({ enabled: false });
    const off = await accept();
    expect(off.status).toBe(400);
    expect(off.body.error.code).toBe('GIT_UNAVAILABLE');
    setConfig({ enabled: true });

    expect((await accept()).status).toBe(201);
    const again = await accept({ name: 'v2' });
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('SHADOW_NOT_FOUND');
    expect(dbState().releases).toEqual([
      { name: 'v0', slug: 'v0' },
      { name: 'v1', slug: 'v1' },
    ]);
  });

  it('[section:ezudoqef] the acceptance holds the repository lock through its sequence: a sidebar checkout meanwhile answers busy; the suppression covers the shadow paths and is lifted at the end', async () => {
    await baseScenario();
    let reached!: () => void;
    const atChain = new Promise<void>((resolve) => (reached = resolve));
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => (resume = resolve));
    chainHook = async () => {
      reached();
      await gate;
    };
    const pending = accept().then((r) => r);
    await atChain;
    expect((await gitService.checkout('main')).status).toBe('busy');
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0]!.released).toBe(false);
    expect([...suppressions[0]!.paths].sort()).toEqual(
      ['pages/a.md', 'pages/c.md', '.claude4spec/entities/endpoint/e1.json', '.claude4spec/entities/endpoint/e2.json', '.claude4spec/entities/endpoint/e3.json']
        .map((p) => path.join(dir, p))
        .sort(),
    );
    resume();
    expect((await pending).status).toBe(201);
    expect(suppressions[0]!.released).toBe(true);
    expect(broadcasts).toContainEqual({ kind: 'git:status-changed', headChanged: true });
  });

  it('[section:g4rsukyw] the release mutex covers a plain creation and an update assigning versions: both wait while it is held, and a holder that fails releases it', async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => (resume = resolve));
    const holder = releaseService.withReleaseMutex(() => gate);
    const done: string[] = [];
    const creating = request(app)
      .post('/api/releases')
      .send({ name: 'v1', description: 'waits' })
      .then((r) => (done.push('create'), r));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(done).toEqual([]);
    resume();
    await holder;
    expect((await creating).status).toBe(201);

    let resume2!: () => void;
    const gate2 = new Promise<void>((resolve) => (resume2 = resolve));
    const holder2 = releaseService.withReleaseMutex(() => gate2);
    const updating = request(app)
      .patch('/api/releases/v1')
      .send({ assignUnreleased: true })
      .then((r) => (done.push('update'), r));
    // A plain rename does not take the mutex.
    expect((await request(app).patch('/api/releases/v1').send({ description: 'renamed meanwhile' })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(done).toEqual(['create']);
    resume2();
    await holder2;
    expect((await updating).status).toBe(200);

    await expect(releaseService.withReleaseMutex(() => Promise.reject(new Error('holder failed')))).rejects.toThrow('holder failed');
    expect((await request(app).post('/api/releases').send({ name: 'v2', description: 'after a failed holder' })).status).toBe(201);
  });

  // ─── failures after the merge — the rollback ────────────────────────────────

  /** Fail the in-band chain of a.md (after the merge, before the release). */
  const failChainOfA = (): void => {
    chainHook = (abs, event) => {
      if (abs === path.join(pagesDir, 'a.md') && event !== 'unlink' && read('pages/a.md')?.includes('shadow')) {
        throw new Error('injected chain failure');
      }
    };
  };

  it('[ac:ac-porazka-po-scaleniu-a-przed-utworzeni] a failure after the merge and before the release, with no other writes meanwhile, leaves HEAD as before the call — and the mutex and the lock are released (a second call succeeds)', async () => {
    await baseScenario();
    failChainOfA();
    const res = await accept();
    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).error.code).toBe('ACCEPT_FAILED');
    expect(await head()).toBe(headSha);
    expect((await git(['symbolic-ref', 'HEAD'], dir)).trim()).toBe('refs/heads/main');
    expect(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(suppressions[0]!.released).toBe(true);
    expect(broadcasts).toContainEqual({ kind: 'git:status-changed', headChanged: false });

    chainHook = null;
    expect((await accept()).status).toBe(201);
    expect((await request(app).post('/api/releases').send({ name: 'v2', description: 'after' })).status).toBe(201);
  });

  it('[ac:ac-porazka-po-scaleniu-a-przed-utworzeni-2] a failure after the merge and before the release, with no other writes meanwhile, leaves the index as before the call', async () => {
    await baseScenario();
    const before = await git(['ls-files', '--stage'], dir);
    failChainOfA();
    expect((await accept()).status).toBe(500);
    expect(await git(['ls-files', '--stage'], dir)).toBe(before);
    expect(await git(['diff', '--cached', '--name-only'], dir)).toBe('');
  });

  it('[ac:ac-porazka-po-scaleniu-a-przed-utworzeni-3] a failure after the merge and before the release, with no other writes meanwhile, leaves the shadow paths in the working tree as before the call', async () => {
    await baseScenario();
    const before = await repoState();
    failChainOfA();
    expect((await accept()).status).toBe(500);
    const after = await repoState();
    expect(after.worktree).toEqual(before.worktree);
    expect(after.status).toBe(before.status);
    expect(after).toEqual(before);
  });

  it('[ac:ac-nieudany-zapis-pliku-wydania-przy-prz] a failed write of the release file during the acceptance leaves HEAD as before the call — no release, no file, no cache row', async () => {
    await baseScenario();
    const before = await repoState();
    const dbBefore = dbState();
    vi.spyOn(ReleaseFileStore.prototype, 'write').mockImplementation(() => {
      throw new Error('EACCES: injected release-file write failure');
    });
    const res = await accept();
    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).error.code).toBe('ACCEPT_FAILED');
    expect((res.body as ErrorBody).error.message).toContain('injected release-file write failure');
    expect(await head()).toBe(headSha);
    expect(await repoState()).toEqual(before);
    expect(dbState()).toEqual(dbBefore);
  });

  it('[ac:ac-po-nieudanym-przyjeciu-liczba-wierszy] after a failed acceptance the number of unreleased file_version rows of the merged pages is what it was before the call', async () => {
    await baseScenario();
    const before = { a: unreleasedPageRows('a.md'), c: unreleasedPageRows('c.md') };
    const dbBefore = dbState();
    // Fail late — after every chain ran and wrote its version.
    vi.spyOn(ReleaseFileStore.prototype, 'write').mockImplementation(() => {
      throw new Error('injected');
    });
    expect((await accept()).status).toBe(500);
    expect({ a: unreleasedPageRows('a.md'), c: unreleasedPageRows('c.md') }).toEqual(before);
    expect(dbState().fileVersions).toEqual(dbBefore.fileVersions);
  });

  it('[ac:ac-nieudane-przyjecie-cienia-dodajacego] a failed acceptance of a shadow adding a page leaves no delete row for that page', async () => {
    await baseScenario();
    vi.spyOn(ReleaseFileStore.prototype, 'write').mockImplementation(() => {
      throw new Error('injected');
    });
    expect((await accept()).status).toBe(500);
    expect(read('pages/c.md')).toBeNull();
    expect(pageRows('c.md').filter((r) => r.op === 'delete')).toEqual([]);
    expect(pageRows('c.md')).toEqual([]);
  });

  it('[ac:ac-po-nieudanym-przyjeciu-entity-version] after a failed acceptance entity_version has no new rows for the entities the shadow changed', async () => {
    await baseScenario();
    const before = { e1: entityRows('e1'), e2: entityRows('e2'), e3: entityRows('e3') };
    vi.spyOn(ReleaseFileStore.prototype, 'write').mockImplementation(() => {
      throw new Error('injected');
    });
    expect((await accept()).status).toBe(500);
    expect({ e1: entityRows('e1'), e2: entityRows('e2'), e3: entityRows('e3') }).toEqual(before);
    // The rollback's chains brought the index back with the files.
    expect(index.get('endpoint/e1')).toMatchObject({ summary: 'v1' });
    expect(index.has('endpoint/e2')).toBe(true);
    expect(index.has('endpoint/e3')).toBe(false);
  });

  it('[section:wh8x023p] a refused release transaction removes the written release file and its cache row, then rolls the merge back', async () => {
    await baseScenario();
    const before = await repoState();
    const dbBefore = dbState();
    vi.spyOn(versions, 'createVersion').mockImplementation(() => {
      throw new Error('injected transaction refusal');
    });
    const res = await accept();
    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).error.code).toBe('ACCEPT_FAILED');
    expect(read('.claude4spec/releases/v1.json')).toBeNull();
    expect(await repoState()).toEqual(before);
    expect(dbState()).toEqual(dbBefore);
  });

  it('[section:wh8x023p] a failure AFTER the release transaction committed (reading the release back) is past the point of no return: the release file, its cache row and the versions stay, the merge commit lands, nothing is rolled back', async () => {
    await baseScenario();
    const breakdown = vi
      .spyOn(releaseService as unknown as { computeCountBreakdown(id: number): unknown }, 'computeCountBreakdown')
      .mockImplementationOnce(() => {
        throw new Error('injected read-back failure');
      });
    const res = await accept();
    expect(breakdown).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).error.message).toContain('injected read-back failure');
    expect((res.body as ErrorBody).error.code).not.toBe('ACCEPT_FAILED');
    // The error answer says the release commit landed — HEAD moved (the client keeps its own-op mark).
    expect((res.body as ErrorBody).error.gitSync?.status).toBe('committed');

    // The release file and its cache row stay.
    const file = JSON.parse(read('.claude4spec/releases/v1.json')!) as { acceptedShadow: { id: string; tipSha: string } };
    expect(file.acceptedShadow).toEqual({ id: 'run-1/spec', tipSha: tip });
    expect(dbState().releases).toEqual([
      { name: 'v0', slug: 'v0' },
      { name: 'v1', slug: 'v1' },
    ]);
    const v1 = releaseIdOf('v1');
    // The versions the transaction wrote and assigned point at an existing release.
    expect(entityRows('e1').at(-1)).toEqual({ op: 'update', changed_by: 'agent', release_id: v1 });
    expect(entityRows('e3')).toEqual([{ op: 'create', changed_by: 'agent', release_id: v1 }]);
    expect(pageRows('c.md').map((r) => r.release_id)).toEqual([v1]);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM entity_version WHERE release_id IS NOT NULL AND release_id NOT IN (SELECT id FROM spec_release)`).get() as { n: number }).n,
    ).toBe(0);

    // No rollback: the merge commit landed with the release file, two parents.
    expect(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))).toBe(false);
    expect((await git(['rev-list', '--parents', '-n', '1', 'HEAD'], dir)).trim().split(' ').slice(1)).toEqual([headSha, tip]);
    expect(JSON.parse(await git(['show', 'HEAD:.claude4spec/releases/v1.json'], dir))).toMatchObject({ name: 'v1' });
    expect(read('pages/c.md')).toBe('# C\n\nC shadow\n');
    expect(broadcasts).toContainEqual({ kind: 'git:status-changed', headChanged: true });
    expect(suppressions[0]!.released).toBe(true);

    // Mutex and lock released; the release reads back now.
    const listed = await request(app).get('/api/releases');
    expect((listed.body as { releases: Array<{ name: string }> }).releases.map((r) => r.name)).toEqual(['v1', 'v0']);
    expect((await request(app).post('/api/releases').send({ name: 'v2', description: 'after' })).status).toBe(201);
  });

  it('[section:rnwev4kg] an abort that fails → 500 ACCEPT_ABORT_FAILED with recovery.kind merge-abort-failed; the merge stays open and there is no release', async () => {
    await baseScenario();
    failChainOfA();
    vi.spyOn(gitService, 'abortMerge').mockResolvedValue({
      status: 'error',
      message: 'injected abort failure',
      recovery: { operation: 'commit-on-release', reason: 'injected abort failure', gitStderr: '', intentPrompt: 'end the merge', kind: 'merge-abort-failed' },
    });
    const res = await accept();
    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).error.code).toBe('ACCEPT_ABORT_FAILED');
    expect((res.body as ErrorBody).error.recovery?.kind).toBe('merge-abort-failed');
    expect(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(dbState().releases).toEqual([{ name: 'v0', slug: 'v0' }]);
    expect(suppressions[0]!.released).toBe(true);
    await git(['merge', '--abort'], dir);
  });

  it('[ac:ac-wydanie-utworzone-przez-release-creat] a release created by release_create while the acceptance holds the release mutex contains none of the versions the shadow brought', async () => {
    await baseScenario();
    let reached!: () => void;
    const atChain = new Promise<void>((resolve) => (reached = resolve));
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => (resume = resolve));
    chainHook = async () => {
      reached();
      await gate;
    };
    const accepting = accept().then((r) => r);
    await atChain;
    let created = false;
    const creating = request(app)
      .post('/api/releases')
      .send({ name: 'v2', description: 'Created meanwhile' })
      .then((r) => {
        created = true;
        return r;
      });
    await new Promise((resolve) => setTimeout(resolve, 150));
    // It waits for the mutex.
    expect(created).toBe(false);
    resume();
    const [acc, cre] = await Promise.all([accepting, creating]);
    expect(acc.status).toBe(201);
    expect(cre.status).toBe(201);
    expect(cre.body.countBreakdown).toEqual({ entities: {}, pages: 0, total: 0 });
    expect(acc.body.countBreakdown.total).toBe(5);
    // Its file did not ride in the acceptance commit.
    const acceptance = (await gitService.resolveReleaseCommit(path.join(dir, '.claude4spec/releases/v1.json')))!;
    const inAcceptance = (await git(['diff', '--name-only', `${acceptance}^1`, acceptance], dir)).split('\n');
    expect(inAcceptance).toContain('.claude4spec/releases/v1.json');
    expect(inAcceptance).not.toContain('.claude4spec/releases/v2.json');
    expect((await git(['rev-list', '--parents', '-n', '1', acceptance], dir)).trim().split(' ')).toHaveLength(3);
  });

  // ─── 2.1.52: the pending-changes test depends on the root ─────────────────────

  describe('2.1.52 — release content whole, the other registry roots only on collisions with the shadow', () => {
    const PLANS = '.claude4spec/plans';
    const SKILL = '.claude4spec/skills/s/SKILL.md';
    /** Committed plans + a skill on the master; the shadow edits a.md and runs `edit`; HEAD stays at that commit. */
    const plansScenario = async (edit: () => void = () => {}): Promise<void> => {
      write(`${PLANS}/kept.md`, '# Kept\n');
      write(`${PLANS}/touched.md`, '# Touched\n');
      write(`${PLANS}/gone.md`, '# Gone\n');
      write(SKILL, '---\nname: s\ndescription: a skill\n---\n# S\n');
      const base = await commitAll('plans and a skill');
      tip = await shadow('run-1/spec', base, () => {
        write('pages/a.md', '# A\n\nA shadow\n');
        edit();
      });
      headSha = base;
    };
    const expectDirty = async (paths: string[]): Promise<void> => {
      const before = await repoState();
      const dbBefore = dbState();
      const res = await accept();
      expect(res.status).toBe(409);
      expect((res.body as ErrorBody).error.details).toEqual(paths);
      expect((res.body as ErrorBody).error.message).toContain('pending changes that collide with the merge');
      await expectUntouched(res, 'ACCEPT_DIRTY', before, dbBefore);
    };

    it('[ac:ac-nowy-plik-niesledzony-w-korzeniu-rele] a new untracked file in the releases root → 409 ACCEPT_DIRTY', async () => {
      await baseScenario();
      write('.claude4spec/releases/stray.json', '{}\n');
      await expectDirty(['.claude4spec/releases/stray.json']);
    });

    it('[ac:ac-zmodyfikowany-plik-sledzony-w-korzeni-5] a modified tracked file in the releases root → 409 ACCEPT_DIRTY', async () => {
      await baseScenario();
      write('.claude4spec/releases/v0.json', `${read('.claude4spec/releases/v0.json')!.trimEnd()} \n`);
      await expectDirty(['.claude4spec/releases/v0.json']);
    });

    it('[ac:ac-niesledzony-plik-w-korzeniu-plans-kto] an untracked file in plans that the shadow adds → 409 ACCEPT_DIRTY', async () => {
      await plansScenario(() => write(`${PLANS}/new.md`, '# New — shadow\n'));
      write(`${PLANS}/new.md`, '# New — mine\n');
      await expectDirty([`${PLANS}/new.md`]);
    });

    it('[ac:ac-niesledzony-plik-plans-x-przy-cieniu] an untracked file plans/x with the shadow adding plans/x/a.md → 409 ACCEPT_DIRTY', async () => {
      await plansScenario(() => write(`${PLANS}/x/a.md`, '# A — shadow\n'));
      write(`${PLANS}/x`, 'a file where the shadow puts a directory\n');
      await expectDirty([`${PLANS}/x`]);
    });

    it('[ac:ac-zmodyfikowany-plik-sledzony-w-korzeni-3] a modified tracked file in plans that the shadow changes → 409 ACCEPT_DIRTY', async () => {
      await plansScenario(() => write(`${PLANS}/touched.md`, '# Touched — shadow\n'));
      write(`${PLANS}/touched.md`, '# Touched — mine\n');
      await expectDirty([`${PLANS}/touched.md`]);
    });

    it('[ac:ac-zmodyfikowany-plik-sledzony-w-korzeni-6] a modified tracked file in plans that the shadow deletes → 409 ACCEPT_DIRTY', async () => {
      await plansScenario(() => fs.rmSync(path.join(dir, PLANS, 'gone.md')));
      write(`${PLANS}/gone.md`, '# Gone — mine\n');
      await expectDirty([`${PLANS}/gone.md`]);
    });

    it('[ac:ac-zastage-owany-plik-w-korzeniu-plans-a] a staged file in plans, whatever the shadow does → 409 ACCEPT_DIRTY', async () => {
      await plansScenario();
      write(`${PLANS}/kept.md`, '# Kept — staged\n');
      await git(['add', `${PLANS}/kept.md`], dir);
      await expectDirty([`${PLANS}/kept.md`]);
    });

    it('[ac:ac-zmodyfikowany-plik-sledzony-w-korzeni-2] a modified tracked file in plans that the shadow does not change does not block the acceptance', async () => {
      await plansScenario(() => write(`${PLANS}/touched.md`, '# Touched — shadow\n'));
      write(`${PLANS}/kept.md`, '# Kept — mine\n');
      expect((await accept()).status).toBe(201);
    });

    it('[ac:ac-nowy-plik-niesledzony-w-korzeniu-plan] a new untracked file in plans that the shadow does not add does not block the acceptance', async () => {
      await plansScenario(() => write(`${PLANS}/new.md`, '# New — shadow\n'));
      write(`${PLANS}/draft.md`, '# Draft\n');
      expect((await accept()).status).toBe(201);
    });

    it('[ac:ac-zmodyfikowany-plik-sledzony-w-korzeni-4] a modified tracked file in skills that the shadow does not change does not block the acceptance', async () => {
      await plansScenario();
      write(SKILL, '---\nname: s\ndescription: a skill, edited\n---\n# S\n');
      expect((await accept()).status).toBe(201);
    });

    it('[ac:ac-po-udanym-przyjeciu-oczekujacy-plik-k] after a successful acceptance a pending file of the plans root is in the acceptance merge commit', async () => {
      await plansScenario();
      write(`${PLANS}/kept.md`, '# Kept — mine\n');
      write(`${PLANS}/draft.md`, '# Draft\n');
      expect((await accept()).status).toBe(201);
      const inMerge = (await git(['diff', '--name-only', 'HEAD^1', 'HEAD'], dir)).split('\n');
      expect(inMerge).toEqual(expect.arrayContaining([`${PLANS}/kept.md`, `${PLANS}/draft.md`, 'pages/a.md']));
      expect(await git(['show', `HEAD:${PLANS}/kept.md`], dir)).toBe('# Kept — mine\n');
      expect(await git(['status', '--porcelain', '--untracked-files=all', '--', PLANS], dir)).toBe('');
    });

    it('[ac:ac-po-udanym-przyjeciu-oczekujacy-plik-k-2] after a successful acceptance a pending file of the plans root is in no release_diff dimension of the acceptance release', async () => {
      await plansScenario();
      write(`${PLANS}/kept.md`, '# Kept — mine\n');
      write(`${PLANS}/draft.md`, '# Draft\n');
      const res = await accept();
      expect(res.status).toBe(201);
      const delta = await releaseService.getReleaseDiff(releaseIdOf('v0'), res.body.id as number);
      const text = JSON.stringify(delta);
      expect(text).toContain('a.md');
      expect(text).not.toContain('kept.md');
      expect(text).not.toContain('draft.md');
    });

    it('[ac:ac-po-nieudanym-commicie-scalajacym-przy] after a failed acceptance merge commit (merge-open) a pending file of the plans root is staged in the index of the open merge', async () => {
      await plansScenario();
      write(`${PLANS}/kept.md`, '# Kept — mine\n');
      const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
      fs.mkdirSync(path.dirname(hook), { recursive: true });
      fs.writeFileSync(hook, '#!/bin/sh\necho "refused by hook" >&2\nexit 1\n', { mode: 0o755 });
      const res = await accept();
      expect(res.status).toBe(201);
      expect(res.body.gitSync.recovery.kind).toBe('merge-open');
      expect(res.body.gitSync.recovery.intentPrompt).toContain('keep them staged');
      expect(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))).toBe(true);
      expect((await git(['diff', '--cached', '--name-only'], dir)).split('\n')).toContain(`${PLANS}/kept.md`);
      expect(await git(['diff', '--name-only', '--', PLANS], dir)).toBe('');
    });

    /** A rollback with pending plans files: a modified tracked one and an untracked one. */
    const rolledBack = async (): Promise<void> => {
      await plansScenario();
      write(`${PLANS}/kept.md`, '# Kept — mine\n');
      write(`${PLANS}/draft.md`, '# Draft\n');
      failChainOfA();
      const res = await accept();
      expect(res.status).toBe(500);
      expect((res.body as ErrorBody).error.code).toBe('ACCEPT_FAILED');
      expect(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))).toBe(false);
    };

    it('[ac:ac-po-cofnietym-przyjeciu-plik-niesledzo] after a rolled-back acceptance an untracked file in plans stays untracked', async () => {
      await rolledBack();
      expect(await git(['status', '--porcelain', '--untracked-files=all', '--', `${PLANS}/draft.md`], dir)).toBe(`?? ${PLANS}/draft.md\n`);
    });

    it('[ac:ac-po-cofnietym-przyjeciu-plik-niesledzo-2] after a rolled-back acceptance an untracked file in plans has its content from before the call', async () => {
      await rolledBack();
      expect(read(`${PLANS}/draft.md`)).toBe('# Draft\n');
    });

    it('[ac:ac-po-cofnietym-przyjeciu-zmodyfikowany] after a rolled-back acceptance a modified tracked file in plans has its content from before the call', async () => {
      await rolledBack();
      expect(read(`${PLANS}/kept.md`)).toBe('# Kept — mine\n');
    });

    it('[ac:ac-po-cofnietym-przyjeciu-niezastage-owa] after a rolled-back acceptance an unstaged change of a tracked file in plans stays unstaged', async () => {
      await rolledBack();
      expect(await git(['status', '--porcelain', '--', `${PLANS}/kept.md`], dir)).toBe(` M ${PLANS}/kept.md\n`);
      expect(await git(['diff', '--cached', '--name-only'], dir)).toBe('');
    });

    it('[ac:ac-przy-accept-abort-failed-intentprompt] at ACCEPT_ABORT_FAILED the intentPrompt of the repair window does not name a pending plans file the shadow does not change', async () => {
      await plansScenario();
      write(`${PLANS}/kept.md`, '# Kept — mine\n');
      failChainOfA();
      // A real failure of the internal `merge --abort`, so the real repair context is built.
      type GitRunner = { git: (args: string[], cwd: string, ...rest: unknown[]) => Promise<{ stdout: string; stderr: string }> };
      const runner = gitService as unknown as GitRunner;
      const original = runner.git.bind(gitService);
      vi.spyOn(runner, 'git').mockImplementation(async (args, cwd, ...rest) => {
        if (args[0] === 'merge' && args[1] === '--abort') {
          throw Object.assign(new Error('injected abort failure'), { stderr: 'fatal: injected abort failure' });
        }
        return original(args, cwd, ...rest);
      });
      const res = await accept();
      expect(res.status).toBe(500);
      const error = (res.body as ErrorBody).error as ErrorBody['error'] & { recovery: { kind: string; intentPrompt: string } };
      expect(error.code).toBe('ACCEPT_ABORT_FAILED');
      expect(error.recovery.kind).toBe('merge-abort-failed');
      expect(error.recovery.intentPrompt).toContain('pages/a.md');
      expect(error.recovery.intentPrompt).not.toContain('kept.md');
      vi.restoreAllMocks();
      await git(['merge', '--abort'], dir);
    });

    it('git refusing to start the merge over a local change the strict test did not see (a write meanwhile) → 409 ACCEPT_DIRTY, nothing merged', async () => {
      await baseScenario();
      write('pages/a.md', '# A\n\nwritten meanwhile\n');
      vi.spyOn(gitService, 'pendingChanges').mockResolvedValue({ status: 'clean' });
      const res = await accept();
      expect(res.status).toBe(409);
      expect((res.body as ErrorBody).error.code).toBe('ACCEPT_DIRTY');
      expect((res.body as ErrorBody).error.details).toEqual(['pages/a.md']);
      expect(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))).toBe(false);
      expect(await head()).toBe(headSha);
      expect(read('pages/a.md')).toBe('# A\n\nwritten meanwhile\n');
      expect(dbState().releases).toEqual([{ name: 'v0', slug: 'v0' }]);
      expect(suppressions[0]!.released).toBe(true);
    });
  });
});

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitService } from '../services/git.js';
import { ProjectWsEmitter } from '../ws/project-emitter.js';
import type { WsGateway } from '../ws/gateway.js';
import { FileWatchRuntime, type WatchScope } from '../fs/watcher.js';
import { headChangeOriginMarker } from '../fs/head-change-origin.js';
import { ProjectContextCache } from '../workspace/context-cache.js';
import type { ProjectContext } from '../workspace/project-context.js';
import type { ProjectRecord } from '../workspace/types.js';
import { gitRouter } from './git.js';
import { errorHandler } from './errors.js';

/**
 * 2.1.10 (M28 9j5dmxyp…wyfi1e4o, endpoint post-api-git-sync, dto
 * git-sync-response; M40 j37qjvvh; M31 ic35jwy6; M49 7xmafzkd) —
 * `POST /api/git/sync` against real repositories: a bare "remote", the
 * project's working repo tracking it (`work`), and a teammate's clone
 * (`other`) pushing commits `work` has not fetched yet.
 */

const pexec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd });
  return stdout;
}

async function head(dir: string): Promise<string> {
  return (await git(['rev-parse', 'HEAD'], dir)).trim();
}

async function identity(dir: string, name: string, email: string): Promise<void> {
  await git(['config', 'user.email', email], dir);
  await git(['config', 'user.name', name], dir);
}

function writeConfigJson(cwd: string, gitCfg: Record<string, unknown>): void {
  const dir = path.join(cwd, '.claude4spec');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify(
      { $schemaVersion: 4, name: 'test', roots: [{ id: 'pages', name: 'Pages', dir: '.', builtin: true }], git: gitCfg },
      null,
      2,
    ),
  );
}

/** Write `files` in `dir`, commit them as `message`. */
async function commitFiles(dir: string, files: Record<string, string>, message: string): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
    await git(['add', rel], dir);
  }
  await git(['commit', '-m', message], dir);
}

/** The teammate commits `files` in `other` and pushes them to the bare remote. */
async function teammatePushes(other: string, files: Record<string, string>, message = 'remote change'): Promise<void> {
  await commitFiles(other, files, message);
  await git(['push', 'origin', 'main'], other);
}

/** An HTTP "remote" holding its first answer back — keeps a fetch (and the repository lock) in flight. */
async function slowRemote(delayMs: number): Promise<{ url: string; hit: Promise<void>; close: () => Promise<void> }> {
  let onHit!: () => void;
  const hit = new Promise<void>((resolve) => (onHit = resolve));
  const server = http.createServer((_req, res) => {
    onHit();
    setTimeout(() => {
      res.writeHead(404);
      res.end('not found');
    }, delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/repo.git`,
    hit,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Isolate from the developer's global/system git config.
const savedEnv: Record<string, string | undefined> = {};
let emptyGlobalConfig: string;
beforeAll(() => {
  emptyGlobalConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-gitcfg-')), 'gitconfig');
  fs.writeFileSync(emptyGlobalConfig, '');
  for (const [k, v] of Object.entries({
    GIT_CONFIG_GLOBAL: emptyGlobalConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  })) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(path.dirname(emptyGlobalConfig), { recursive: true, force: true });
});

describe('POST /api/git/sync (2.1.10)', () => {
  let base: string;
  let work: string;
  let bare: string;
  let other: string;

  function appFor(svc: GitService, onHeadChanged?: () => void): express.Express {
    return express().use(express.json()).use('/api/git', gitRouter(svc, { onHeadChanged })).use(errorHandler);
  }

  beforeEach(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-sync-'));
    work = path.join(base, 'work');
    bare = path.join(base, 'remote.git');
    other = path.join(base, 'other');

    await pexec('git', ['init', '--bare', '-b', 'main', bare]);
    fs.mkdirSync(work, { recursive: true });
    await git(['init', '-b', 'main'], work);
    await identity(work, 'Test', 'test@example.com');
    writeConfigJson(work, { enabled: true });
    await commitFiles(work, { 'page.md': '# page v1\n', 'notes.md': '# notes v1\n' }, 'first');
    await git(['remote', 'add', 'origin', bare], work);
    await git(['push', '-u', 'origin', 'main'], work);

    await pexec('git', ['clone', bare, other]);
    await identity(other, 'Mate', 'mate@example.com');
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('[entity:post-api-git-sync] [entity:git-sync-response] [ac:ac-post-api-git-sync-przy-ahead-0-i-behi] ahead 0 / behind > 0 → 200 { status: fast-forwarded, paths: null, reason: null, message: null }', async () => {
    await teammatePushes(other, { 'remote-1.md': '# remote 1\n' });
    const upstream = (await git(['rev-parse', 'HEAD'], other)).trim();
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['message', 'paths', 'reason', 'status']);
    expect(res.body).toEqual({ status: 'fast-forwarded', paths: null, reason: null, message: null });
    expect(await head(work)).toBe(upstream);
    expect(fs.readFileSync(path.join(work, 'remote-1.md'), 'utf8')).toBe('# remote 1\n');
  });

  it('[ac:ac-post-api-git-sync-przy-behind-0-i-ahe] behind 0 / ahead > 0 → up-to-date, nothing pushed or moved', async () => {
    await commitFiles(work, { 'local.md': '# local\n' }, 'local only');
    const before = await head(work);
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'up-to-date', paths: null, reason: null, message: null });
    expect(await head(work)).toBe(before);
    // Sending belongs to push: the remote still lacks the local commit.
    expect((await git(['rev-parse', 'main'], bare)).trim()).not.toBe(before);
  });

  it('[ac:ac-post-api-git-sync-przy-rozjezdzie-z-u] divergence without conflicts → merged', async () => {
    await commitFiles(work, { 'local.md': '# local\n' }, 'local');
    await teammatePushes(other, { 'remote-1.md': '# remote 1\n' });
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'merged', paths: null, reason: null, message: null });
    expect(fs.existsSync(path.join(work, 'local.md'))).toBe(true);
    expect(fs.readFileSync(path.join(work, 'remote-1.md'), 'utf8')).toBe('# remote 1\n');
    expect((await git(['status', '--porcelain', '--untracked-files=no'], work)).trim()).toBe('');
  });

  it('[ac:ac-po-post-api-git-sync-z-wynikiem-merge] after merged, HEAD of the current branch is a commit with two parents', async () => {
    await commitFiles(work, { 'local.md': '# local\n' }, 'local');
    const localTip = await head(work);
    await teammatePushes(other, { 'remote-1.md': '# remote 1\n' });
    const remoteTip = (await git(['rev-parse', 'HEAD'], other)).trim();
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.body.status).toBe('merged');
    expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], work)).trim()).toBe('main');
    const parents = (await git(['rev-list', '--parents', '-n', '1', 'HEAD'], work)).trim().split(' ').slice(1);
    expect(parents).toEqual([localTip, remoteTip]);
    expect((await git(['log', '-1', '--format=%s'], work)).trim()).toBe('Merge origin/main into main');
  });

  it('[ac:ac-post-api-git-sync-przy-rozjezdzie-z-u-2] divergence with modified tracked files → dirty-blocked, nothing changed', async () => {
    await commitFiles(work, { 'local.md': '# local\n' }, 'local');
    await teammatePushes(other, { 'remote-1.md': '# remote 1\n' });
    // A tracked file the incoming commits do not touch — still blocks a merge commit.
    fs.writeFileSync(path.join(work, 'notes.md'), '# notes — unsaved edit\n');
    const before = await head(work);
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'dirty-blocked', paths: ['notes.md'], reason: null, message: null });
    expect(await head(work)).toBe(before);
    expect(fs.readFileSync(path.join(work, 'notes.md'), 'utf8')).toBe('# notes — unsaved edit\n');
    expect(fs.existsSync(path.join(work, 'remote-1.md'))).toBe(false);
  });

  it('[ac:ac-post-api-git-sync-przy-rozjezdzie-z-k] divergence with a content conflict → diverged with reason conflicts and the conflicted path', async () => {
    await commitFiles(work, { 'page.md': '# page — local edit\n' }, 'local edit');
    await teammatePushes(other, { 'page.md': '# page — remote edit\n' });
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'diverged', paths: ['page.md'], reason: 'conflicts', message: null });
  });

  it('[ac:ac-po-post-api-git-sync-z-wynikiem-diver] after diverged, HEAD points at the same commit as before the call', async () => {
    await commitFiles(work, { 'page.md': '# page — local edit\n' }, 'local edit');
    await teammatePushes(other, { 'page.md': '# page — remote edit\n' });
    const before = await head(work);
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.body.status).toBe('diverged');
    expect(await head(work)).toBe(before);
    expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], work)).trim()).toBe('main');
  });

  it('[ac:ac-po-post-api-git-sync-z-wynikiem-diver-2] after diverged, the repository has no merge in progress and no conflict markers', async () => {
    await commitFiles(work, { 'page.md': '# page — local edit\n' }, 'local edit');
    await teammatePushes(other, { 'page.md': '# page — remote edit\n' });
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.body.status).toBe('diverged');
    const mergeHead = await pexec('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: work }).then(
      () => true,
      () => false,
    );
    expect(mergeHead).toBe(false);
    expect(fs.existsSync(path.join(work, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(fs.readFileSync(path.join(work, 'page.md'), 'utf8')).toBe('# page — local edit\n');
    expect((await git(['status', '--porcelain', '--untracked-files=no'], work)).trim()).toBe('');
  });

  it('[ac:ac-post-api-git-sync-przy-nowych-wydania] new releases locally and on the remote since the common ancestor → diverged with reason releases-on-both-sides', async () => {
    await commitFiles(work, { '.claude4spec/releases/v2.json': '{"name":"v2"}\n' }, 'Release v2');
    await teammatePushes(other, { '.claude4spec/releases/v3.json': '{"name":"v3"}\n' }, 'Release v3');
    const before = await head(work);
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'diverged', paths: null, reason: 'releases-on-both-sides', message: null });
    expect(await head(work)).toBe(before);
  });

  it('a new release on one side only does not block the merge', async () => {
    await commitFiles(work, { '.claude4spec/releases/v2.json': '{"name":"v2"}\n' }, 'Release v2');
    await teammatePushes(other, { 'remote-1.md': '# remote 1\n' });
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.body.status).toBe('merged');
  });

  it('[ac:ac-post-api-git-sync-przy-lokalnej-zmian] a local change to a file the incoming commits change → dirty-blocked with that path', async () => {
    await teammatePushes(other, { 'page.md': '# page — remote edit\n' });
    fs.writeFileSync(path.join(work, 'page.md'), '# page — unsaved local edit\n');
    const before = await head(work);
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('dirty-blocked');
    expect(res.body.paths).toEqual(['page.md']);
    expect(await head(work)).toBe(before);
    expect(fs.readFileSync(path.join(work, 'page.md'), 'utf8')).toBe('# page — unsaved local edit\n');
  });

  it('[ac:ac-post-api-git-sync-przy-niesledzonym-p] an untracked file colliding with an incoming one → dirty-blocked with that path', async () => {
    await teammatePushes(other, { 'new.md': '# new — remote\n' });
    fs.writeFileSync(path.join(work, 'new.md'), '# new — local, untracked\n');
    const before = await head(work);
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('dirty-blocked');
    expect(res.body.paths).toEqual(['new.md']);
    expect(await head(work)).toBe(before);
    expect(fs.readFileSync(path.join(work, 'new.md'), 'utf8')).toBe('# new — local, untracked\n');
  });

  it('[ac:ac-lokalna-zmiana-pliku-ktorego-przychod] a local change to a file the incoming commits do not touch stays in the working tree after fast-forwarded', async () => {
    await teammatePushes(other, { 'remote-1.md': '# remote 1\n' });
    fs.writeFileSync(path.join(work, 'notes.md'), '# notes — unsaved local edit\n');
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.body.status).toBe('fast-forwarded');
    expect(fs.readFileSync(path.join(work, 'notes.md'), 'utf8')).toBe('# notes — unsaved local edit\n');
    expect((await git(['status', '--porcelain', '--untracked-files=no'], work)).trim()).toBe('M notes.md');
  });

  it('[ac:ac-post-api-git-sync-na-galezi-bez-upstr] on a branch without an upstream → no-upstream', async () => {
    await git(['checkout', '-b', 'feature'], work);
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'no-upstream', paths: null, reason: null, message: null });
  });

  it('[ac:ac-post-api-git-sync-przy-config-git-ena] with config.git.enabled === false → skipped, nothing fetched or moved', async () => {
    writeConfigJson(work, { enabled: false });
    await teammatePushes(other, { 'remote-1.md': '# remote 1\n' });
    const before = await head(work);
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'skipped', paths: null, reason: null, message: null });
    expect(await head(work)).toBe(before);
    expect((await git(['rev-parse', 'origin/main'], work)).trim()).toBe(before);
  });

  it('[ac:ac-post-api-git-sync-w-detached-head-zwr] on a detached HEAD → skipped', async () => {
    await teammatePushes(other, { 'remote-1.md': '# remote 1\n' });
    await git(['checkout', '--detach'], work);
    const before = await head(work);
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'skipped', paths: null, reason: null, message: null });
    expect(await head(work)).toBe(before);
  });

  it('[ac:ac-post-api-git-sync-w-trakcie-innej-ope] during another git operation on the repository → busy', async () => {
    const remote = await slowRemote(1500);
    try {
      await git(['remote', 'set-url', 'origin', remote.url], work);
      const svc = new GitService(work, [work]);
      const fetchP = svc.fetch();
      await remote.hit; // the fetch holds the repository lock now
      const before = await head(work);
      const res = await request(appFor(svc)).post('/api/git/sync');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'busy', paths: null, reason: null, message: null });
      expect(await head(work)).toBe(before);
      await fetchP;
    } finally {
      await remote.close();
    }
  }, 30_000);

  it('[ac:ac-post-api-git-sync-w-trakcie-tury-agen] during an agent turn mutating disk → busy, HEAD unchanged', async () => {
    await teammatePushes(other, { 'remote-1.md': '# remote 1\n' });
    const before = await head(work);
    const inFlightTurn = () => true;
    const res = await request(appFor(new GitService(work, [work], inFlightTurn))).post('/api/git/sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'busy', paths: null, reason: null, message: null });
    expect(await head(work)).toBe(before);
    expect(fs.existsSync(path.join(work, 'remote-1.md'))).toBe(false);
  });

  it('[ac:ac-zdarzenie-git-status-changed-po-post] git:status-changed after fast-forwarded and after merged carries headChanged: true', async () => {
    const gateway = { broadcast: vi.fn() };
    const ws = new ProjectWsEmitter(gateway as unknown as WsGateway, 'proj-1');
    const app = appFor(new GitService(work, [work], () => false, ws));

    await teammatePushes(other, { 'remote-1.md': '# remote 1\n' });
    const ff = await request(app).post('/api/git/sync');
    expect(ff.body.status).toBe('fast-forwarded');
    expect(gateway.broadcast).toHaveBeenLastCalledWith('proj-1', { kind: 'git:status-changed', headChanged: true });

    await commitFiles(work, { 'local.md': '# local\n' }, 'local');
    await teammatePushes(other, { 'remote-2.md': '# remote 2\n' });
    gateway.broadcast.mockClear();
    const merged = await request(app).post('/api/git/sync');
    expect(merged.body.status).toBe('merged');
    expect(gateway.broadcast).toHaveBeenCalledTimes(1);
    expect(gateway.broadcast).toHaveBeenCalledWith('proj-1', { kind: 'git:status-changed', headChanged: true });
  });

  it('results that leave HEAD alone emit headChanged: false (skipped / no-upstream emit nothing)', async () => {
    const gateway = { broadcast: vi.fn() };
    const ws = new ProjectWsEmitter(gateway as unknown as WsGateway, 'proj-1');
    const app = appFor(new GitService(work, [work], () => false, ws));

    const upToDate = await request(app).post('/api/git/sync');
    expect(upToDate.body.status).toBe('up-to-date');
    expect(gateway.broadcast).toHaveBeenCalledWith('proj-1', { kind: 'git:status-changed', headChanged: false });

    gateway.broadcast.mockClear();
    await git(['checkout', '-b', 'feature'], work);
    expect((await request(app).post('/api/git/sync')).body.status).toBe('no-upstream');
    expect(gateway.broadcast).not.toHaveBeenCalled();
  });

  it('[ac:ac-strona-otwarta-w-edytorze-i-zmieniona] a page changed by sync reaches the reaction chain with origin "server" (no "File changed externally" window)', async () => {
    const CTX: WatchScope = 'context:proj-1#1';
    const runtime = new FileWatchRuntime({ fsEvents: false });
    try {
      runtime.mountSource({ source: 'pages:pages', dir: work, scope: CTX });
      const origins = new Map<string, string>();
      runtime.subscribe(
        'pages:pages',
        {
          onChange: (_s, _src, relPath, origin) => void origins.set(relPath, origin),
          onUnlink: () => {},
        },
        { id: 'm02-notify', phase: 'notification', scope: CTX },
      );
      // The labels must land on the CURRENT instance, before HEAD moves.
      const headAtLabel: string[] = [];
      const marker = headChangeOriginMarker(runtime.scoped(CTX), () => [{ source: 'pages:pages', dir: work }]);
      const svc = new GitService(work, [work], () => false, null, (abs) => {
        headAtLabel.push(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim());
        marker(abs);
      });
      await teammatePushes(other, { 'page.md': '# page — remote edit\n' });
      const before = await head(work);

      const res = await request(appFor(svc)).post('/api/git/sync');
      expect(res.body.status).toBe('fast-forwarded');
      expect(headAtLabel[0]).toBe(before); // labelled before the HEAD change

      // The provider reports the rewritten page; its chain runs with origin 'server'.
      await runtime.flush(CTX, 'pages:pages', 'page.md');
      expect(origins.get('page.md')).toBe('server');
      // A file the sync did not touch is not labelled.
      await runtime.flush(CTX, 'pages:pages', 'notes.md');
      expect(origins.get('notes.md')).toBe('external');
    } finally {
      await runtime.close();
    }
  });

  it('checkout labels the paths differing from the target branch before switching and emits headChanged: true', async () => {
    await git(['checkout', '-b', 'other-branch'], work);
    await commitFiles(work, { 'page.md': '# page — other branch\n' }, 'other branch');
    await git(['checkout', 'main'], work);
    const gateway = { broadcast: vi.fn() };
    const ws = new ProjectWsEmitter(gateway as unknown as WsGateway, 'proj-1');
    const labelled: Array<{ head: string; paths: string[] }> = [];
    const svc = new GitService(work, [work], () => false, ws, (abs) => {
      labelled.push({
        head: execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim(),
        paths: abs,
      });
    });
    const onHeadChanged = vi.fn();
    const res = await request(appFor(svc, onHeadChanged)).post('/api/git/checkout').send({ branch: 'other-branch' });
    expect(res.body.status).toBe('switched');
    expect(labelled[0]).toEqual({ head: 'main', paths: [path.join(fs.realpathSync(work), 'page.md')] });
    expect(gateway.broadcast).toHaveBeenCalledWith('proj-1', { kind: 'git:status-changed', headChanged: true });
    expect(onHeadChanged).toHaveBeenCalledTimes(1);
  });

  describe('M31 reload contract after a sync that moved HEAD', () => {
    const ENTITY = path.join('.claude4spec', 'entities', 'endpoint', 'get-users.json');

    /**
     * The real `ProjectContextCache`, with a builder that — like the M29
     * `indexAll()` a real build awaits — reads the entity file from disk when
     * the context is built. `onHeadChanged` is wired exactly as
     * `buildProjectContext` wires it in production: the cache's `invalidate`.
     */
    function reloadingApp(svc: GitService): { app: express.Express; entityTitle: () => Promise<string>; builds: () => number } {
      let builds = 0;
      const cache = new ProjectContextCache(async (p: ProjectRecord) => {
        builds++;
        const title = (JSON.parse(fs.readFileSync(path.join(work, ENTITY), 'utf8')) as { title: string }).title;
        return {
          projectId: p.id,
          hasInFlightTurn: () => false,
          dispose: async () => {},
          entityTitle: title,
        } as unknown as ProjectContext;
      });
      const project = { id: 'proj-1', cwd: work } as ProjectRecord;
      return {
        app: appFor(svc, () => cache.invalidate('proj-1')),
        entityTitle: async () => ((await cache.get(project)) as unknown as { entityTitle: string }).entityTitle,
        builds: () => builds,
      };
    }

    it('[ac:ac-po-post-api-git-sync-z-wynikiem-fast] after fast-forwarded the project entities match the new HEAD without a server restart', async () => {
      await commitFiles(work, { [ENTITY]: '{"slug":"get-users","title":"List users"}\n' }, 'entity v1');
      await git(['push', 'origin', 'main'], work);
      await git(['pull', 'origin', 'main'], other);
      await teammatePushes(other, { [ENTITY]: '{"slug":"get-users","title":"List all users"}\n' }, 'entity v2');

      const t = reloadingApp(new GitService(work, [work]));
      expect(await t.entityTitle()).toBe('List users');
      const res = await request(t.app).post('/api/git/sync');
      expect(res.body.status).toBe('fast-forwarded');
      expect(await t.entityTitle()).toBe('List all users');
      expect(t.builds()).toBe(2); // rebuilt in-process — no restart
    });

    it('[ac:ac-po-post-api-git-sync-z-wynikiem-merge-2] after merged the project entities match the new HEAD without a server restart', async () => {
      await commitFiles(work, { [ENTITY]: '{"slug":"get-users","title":"List users"}\n' }, 'entity v1');
      await git(['push', 'origin', 'main'], work);
      await git(['pull', 'origin', 'main'], other);
      await teammatePushes(other, { [ENTITY]: '{"slug":"get-users","title":"List all users"}\n' }, 'entity v2');
      await commitFiles(work, { 'local.md': '# local\n' }, 'local');

      const t = reloadingApp(new GitService(work, [work]));
      expect(await t.entityTitle()).toBe('List users');
      const res = await request(t.app).post('/api/git/sync');
      expect(res.body.status).toBe('merged');
      expect(await t.entityTitle()).toBe('List all users');
      expect(t.builds()).toBe(2);
    });

    it('results that leave HEAD alone do not reload the project', async () => {
      await commitFiles(work, { [ENTITY]: '{"slug":"get-users","title":"List users"}\n' }, 'entity v1');
      const t = reloadingApp(new GitService(work, [work]));
      await t.entityTitle();
      const res = await request(t.app).post('/api/git/sync');
      expect(res.body.status).toBe('up-to-date');
      await t.entityTitle();
      expect(t.builds()).toBe(1);
    });

    it('production wires the reload to the cache invalidation (onHeadChanged → onContextConfigChanged → cache.invalidate)', () => {
      const build = fs.readFileSync(path.join(import.meta.dirname, '../workspace/project-context.ts'), 'utf8');
      expect(build).toContain("router.use('/git', gitRouter(gitService, { onHeadChanged: onContextConfigChanged }));");
      expect(build).toContain('headChangeOriginMarker(w, () => headChangeMounts)');
      const index = fs.readFileSync(path.join(import.meta.dirname, '../index.ts'), 'utf8');
      expect(index).toContain('onContextConfigChanged: () => cache.invalidate(project.id)');
    });
  });
});

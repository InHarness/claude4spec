import { execFile } from 'node:child_process';
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
import { gitRouter } from './git.js';
import { errorHandler } from './errors.js';

/**
 * 2.1.10 (M28 5eyq89gb / m28aug01, M49 7xmafzkd) — `POST /api/git/fetch` and
 * the widened `GET /api/git/status`, against real repositories: a bare
 * "remote", the project's working repo tracking it, and a second clone that
 * pushes commits the working repo has not fetched yet.
 */

const pexec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd });
  return stdout;
}

async function initRepo(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  await git(['init', '-b', 'main'], dir);
  await git(['config', 'user.email', 'test@example.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
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

/** Tracked files and their content + porcelain status — the working tree as a value. */
async function workingTreeSnapshot(dir: string): Promise<{ files: Record<string, string>; porcelain: string }> {
  const files: Record<string, string> = {};
  for (const rel of (await git(['ls-files'], dir)).split('\n').filter(Boolean)) {
    files[rel] = fs.readFileSync(path.join(dir, rel), 'utf8');
  }
  return { files, porcelain: await git(['status', '--porcelain'], dir) };
}

// Isolate from the developer's global/system git config (credential helpers,
// default branch, proxies) — the repos below carry their own identity.
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

describe('POST /api/git/fetch + GET /api/git/status (2.1.10)', () => {
  let base: string;
  let work: string;
  let bare: string;
  let other: string;

  function appFor(svc: GitService): express.Express {
    return express().use(express.json()).use('/api/git', gitRouter(svc)).use(errorHandler);
  }

  beforeEach(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-fetch-'));
    work = path.join(base, 'work');
    bare = path.join(base, 'remote.git');
    other = path.join(base, 'other');

    await pexec('git', ['init', '--bare', '-b', 'main', bare]);
    await initRepo(work);
    writeConfigJson(work, { enabled: true });
    fs.writeFileSync(path.join(work, 'page.md'), '# page v1\n');
    await git(['add', 'page.md'], work);
    await git(['commit', '-m', 'first'], work);
    await git(['remote', 'add', 'origin', bare], work);
    await git(['push', '-u', 'origin', 'main'], work);

    // A teammate pushes 3 commits the working repo has not fetched yet.
    await pexec('git', ['clone', bare, other]);
    await git(['config', 'user.email', 'mate@example.com'], other);
    await git(['config', 'user.name', 'Mate'], other);
    for (const n of [1, 2, 3]) {
      fs.writeFileSync(path.join(other, `remote-${n}.md`), `# remote ${n}\n`);
      await git(['add', '.'], other);
      await git(['commit', '-m', `remote ${n}`], other);
    }
    await git(['push', 'origin', 'main'], other);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('[entity:post-api-git-fetch] [entity:git-fetch-response] POST /api/git/fetch → 200 with { status: fetched, ahead, behind, message: null }', async () => {
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/fetch');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['ahead', 'behind', 'message', 'status']);
    expect(res.body).toEqual({ status: 'fetched', ahead: 0, behind: 3, message: null });
  });

  it('[ac:ac-po-post-api-git-fetch-z-wynikiem-fetc] [entity:git-status-response] after a fetched POST /api/git/fetch, GET /api/git/status reports behind = upstream commits the local branch lacks', async () => {
    const app = appFor(new GitService(work, [work]));
    // Before the fetch the local remote-tracking ref knows nothing new.
    const before = await request(app).get('/api/git/status');
    expect(before.status).toBe(200);
    expect(before.body.behind).toBe(0);

    const fetched = await request(app).post('/api/git/fetch');
    expect(fetched.body.status).toBe('fetched');

    const after = await request(app).get('/api/git/status');
    expect(after.status).toBe(200);
    const upstreamOnly = Number((await git(['rev-list', '--count', 'main..origin/main'], work)).trim());
    expect(upstreamOnly).toBe(3);
    expect(after.body.behind).toBe(upstreamOnly);
    expect(after.body.ahead).toBe(0);
    // Every field of the DTO is present — ahead/behind/lastFetchedAt are no longer optional.
    expect(Object.keys(after.body).sort()).toEqual(
      ['ahead', 'behind', 'branch', 'detected', 'isDirty', 'lastFetchedAt', 'remoteUrl', 'rootPath'].sort(),
    );
  });

  it('[ac:ac-po-pierwszym-post-api-git-fetch-z-wyn] after the first fetched POST /api/git/fetch, GET /api/git/status returns a non-empty lastFetchedAt', async () => {
    const app = appFor(new GitService(work, [work]));
    const before = await request(app).get('/api/git/status');
    expect(before.body.lastFetchedAt).toBeNull(); // the repository never fetched

    const fetched = await request(app).post('/api/git/fetch');
    expect(fetched.body.status).toBe('fetched');

    const after = await request(app).get('/api/git/status');
    expect(typeof after.body.lastFetchedAt).toBe('string');
    expect(after.body.lastFetchedAt).not.toBe('');
    expect(Number.isNaN(Date.parse(after.body.lastFetchedAt))).toBe(false);
  });

  it('[entity:git-status-response] GET /api/git/status outside a repository → detected false with ahead/behind/lastFetchedAt null', async () => {
    const plain = path.join(base, 'plain');
    fs.mkdirSync(plain);
    writeConfigJson(plain, { enabled: true });
    const res = await request(appFor(new GitService(plain, [plain]))).get('/api/git/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      detected: false,
      rootPath: null,
      remoteUrl: null,
      branch: null,
      isDirty: false,
      ahead: null,
      behind: null,
      lastFetchedAt: null,
    });
  });

  it('[ac:ac-gdy-pagesdir-le-y-w-worktree-git-get-a] pagesDir inside a git worktree → GET /api/git/status detected:true with remoteUrl, branch, rootPath and isDirty; outside one → detected:false', async () => {
    const app = appFor(new GitService(work, [work]));
    const toplevel = (await git(['rev-parse', '--show-toplevel'], work)).trim();

    // The working tree carries an untracked `.claude4spec/config.json` → dirty.
    const dirty = await request(app).get('/api/git/status');
    expect(dirty.status).toBe(200);
    expect(dirty.body.detected).toBe(true);
    expect(dirty.body.remoteUrl).toBe(bare);
    expect(dirty.body.branch).toBe('main');
    expect(fs.realpathSync(dirty.body.rootPath)).toBe(fs.realpathSync(toplevel));
    expect(dirty.body.isDirty).toBe(true);

    // Commit everything → the same probe reports a clean tree.
    await git(['add', '-A'], work);
    await git(['commit', '-m', 'all'], work);
    const clean = await request(app).get('/api/git/status');
    expect(clean.body.detected).toBe(true);
    expect(clean.body.isDirty).toBe(false);

    // A pagesDir outside any worktree → detected:false.
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-plain-'));
    try {
      writeConfigJson(plain, { enabled: true });
      const outside = await request(appFor(new GitService(plain, [plain]))).get('/api/git/status');
      expect(outside.status).toBe(200);
      expect(outside.body.detected).toBe(false);
      expect(outside.body.rootPath).toBeNull();
      expect(outside.body.remoteUrl).toBeNull();
      expect(outside.body.branch).toBeNull();
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('[entity:git-status-response] 2.1.14: on detached HEAD GET /api/git/status reports branch null (every field present, typed) — and with branch null the release push and a `current`-mode release commit do not run (null), the pull commit is skipped, `named` still commits', async () => {
    const head = (await git(['rev-parse', 'HEAD'], work)).trim();
    await git(['checkout', head], work);
    writeConfigJson(work, { enabled: true, syncPushOnPush: true });
    const svc = new GitService(work, [work]);

    const res = await request(appFor(svc)).get('/api/git/status');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['ahead', 'behind', 'branch', 'detected', 'isDirty', 'lastFetchedAt', 'remoteUrl', 'rootPath'].sort(),
    );
    expect(res.body.detected).toBe(true);
    expect(typeof res.body.rootPath).toBe('string');
    expect(typeof res.body.remoteUrl).toBe('string');
    expect(res.body.branch).toBeNull();
    expect(typeof res.body.isDirty).toBe('boolean');
    expect(res.body.ahead).toBeNull();
    expect(res.body.behind).toBeNull();
    expect(res.body.lastFetchedAt === null || typeof res.body.lastFetchedAt === 'string').toBe(true);

    fs.writeFileSync(path.join(work, 'page.md'), '# page v2\n');
    expect(await svc.pushOnPush('main')).toBeNull();
    expect(await svc.commitOnRelease({ name: 'v1', description: 'd' })).toBeNull();
    expect(await svc.commitPull({ name: 'v1' })).toEqual({ status: 'skipped' });

    await git(['branch', 'release-target', 'main'], work);
    writeConfigJson(work, { enabled: true, commitTarget: { mode: 'named', branch: 'release-target' } });
    const named = await svc.commitOnRelease({ name: 'v1', description: 'd' });
    expect(named?.status).toBe('committed');
    expect(named?.branch).toBe('release-target');
  });

  it('[ac:ac-po-post-api-git-fetch-z-wynikiem-fetc-2] after a fetched POST /api/git/fetch the server emits git:status-changed to the project room', async () => {
    const gateway = { broadcast: vi.fn() };
    const ws = new ProjectWsEmitter(gateway as unknown as WsGateway, 'proj-1');
    const res = await request(appFor(new GitService(work, [work], () => false, ws))).post('/api/git/fetch');
    expect(res.body.status).toBe('fetched');
    expect(gateway.broadcast).toHaveBeenCalledWith('proj-1', { kind: 'git:status-changed', headChanged: false });
  });

  it('[ac:ac-post-api-git-fetch-nie-zmienia-head] POST /api/git/fetch does not change HEAD', async () => {
    const headBefore = (await git(['rev-parse', 'HEAD'], work)).trim();
    const branchBefore = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], work)).trim();
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/fetch');
    expect(res.body.status).toBe('fetched');
    expect(res.body.behind).toBe(3); // the remote refs DID move…
    expect((await git(['rev-parse', 'HEAD'], work)).trim()).toBe(headBefore); // …HEAD did not
    expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], work)).trim()).toBe(branchBefore);
  });

  it('[ac:ac-post-api-git-fetch-nie-zmienia-plikow] POST /api/git/fetch does not change working-tree files', async () => {
    const before = await workingTreeSnapshot(work);
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/fetch');
    expect(res.body.status).toBe('fetched');
    const after = await workingTreeSnapshot(work);
    expect(after).toEqual(before);
    // The upstream's new files were fetched, not checked out.
    expect(fs.existsSync(path.join(work, 'remote-1.md'))).toBe(false);
  });

  it('[ac:ac-post-api-git-fetch-na-galezi-bez-upst] POST /api/git/fetch on a branch without an upstream → no-upstream', async () => {
    await git(['checkout', '-b', 'feature'], work);
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/fetch');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'no-upstream', ahead: null, behind: null, message: null });
  });

  it('[ac:ac-post-api-git-fetch-przy-config-git-en] POST /api/git/fetch with config.git.enabled === false → skipped', async () => {
    writeConfigJson(work, { enabled: false });
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/fetch');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'skipped', ahead: null, behind: null, message: null });
    // Nothing was fetched.
    expect((await git(['rev-list', '--count', 'main..origin/main'], work)).trim()).toBe('0');
  });

  it('[ac:ac-post-api-git-fetch-w-detached-head-zw] POST /api/git/fetch on a detached HEAD → skipped', async () => {
    await git(['checkout', '--detach'], work);
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/fetch');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'skipped', ahead: null, behind: null, message: null });
  });

  it('[ac:ac-post-api-git-fetch-przy-nieosiagalnym] POST /api/git/fetch to an unreachable remote → error carrying git\'s message', async () => {
    await git(['remote', 'set-url', 'origin', path.join(base, 'does-not-exist.git')], work);
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/fetch');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('error');
    expect(res.body.ahead).toBeNull();
    expect(res.body.behind).toBeNull();
    expect(typeof res.body.message).toBe('string');
    // git's own diagnostic, naming the remote it could not reach.
    expect(res.body.message).toContain('does-not-exist.git');
  });

  it('[ac:ac-post-api-git-fetch-do-remote-wymagaja] POST /api/git/fetch to a remote requiring missing credentials → error within 60 s', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="c4s-test"' });
      res.end('Unauthorized');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await git(['remote', 'set-url', 'origin', `http://127.0.0.1:${port}/repo.git`], work);
      const started = Date.now();
      const res = await request(appFor(new GitService(work, [work]))).post('/api/git/fetch');
      const elapsed = Date.now() - started;
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('error');
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(60_000);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 70_000);

  it('[ac:ac-post-api-git-fetch-przy-zmienionych-p] POST /api/git/fetch with modified tracked files → fetched', async () => {
    fs.writeFileSync(path.join(work, 'page.md'), '# page v2 — unsaved edit\n');
    expect((await git(['status', '--porcelain', '--untracked-files=no'], work)).trim()).not.toBe('');
    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/fetch');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('fetched');
    expect(fs.readFileSync(path.join(work, 'page.md'), 'utf8')).toBe('# page v2 — unsaved edit\n');
  });

  it('[ac:ac-post-api-git-fetch-w-trakcie-tury-age] POST /api/git/fetch during an agent turn mutating disk → fetched', async () => {
    const inFlightTurn = () => true;
    const res = await request(appFor(new GitService(work, [work], inFlightTurn))).post('/api/git/fetch');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('fetched');
    expect(res.body.behind).toBe(3);
  });

  // 2.1.46 (M28 5eyq89gb): after the upstream, fetch() pulls the shadow
  // namespace separately — `+refs/runs/*:refs/runs/*`, forced, pruned only there.
  const refsUnderRuns = async (): Promise<string[]> =>
    (await git(['for-each-ref', '--format=%(refname)', 'refs/runs/'], work)).split('\n').filter(Boolean);

  it('[ac:ac-post-api-git-fetch-z-wynikiem-fetched] POST /api/git/fetch with result fetched brings the refs/runs/* refs of the upstream remote', async () => {
    fs.writeFileSync(path.join(other, 'page.md'), '# page (shadow)\n');
    await git(['commit', '-q', '-am', 'shadow turn'], other);
    const shadowTip = (await git(['rev-parse', 'HEAD'], other)).trim();
    await git(['push', '-q', 'origin', 'HEAD:refs/runs/run-1/spec'], other);
    expect(await refsUnderRuns()).toEqual([]);

    const res = await request(appFor(new GitService(work, [work]))).post('/api/git/fetch');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('fetched');
    expect(await refsUnderRuns()).toEqual(['refs/runs/run-1/spec']);
    expect((await git(['rev-parse', 'refs/runs/run-1/spec'], work)).trim()).toBe(shadowTip);
  });

  it('[ac:ac-ref-refs-runs-usuniety-na-remote-znik] a refs/runs/* ref deleted on the remote disappears locally after a fetch with result fetched', async () => {
    await git(['push', '-q', 'origin', 'HEAD:refs/runs/kept/spec', 'HEAD:refs/runs/gone/spec'], other);
    const app = appFor(new GitService(work, [work]));
    expect((await request(app).post('/api/git/fetch')).body.status).toBe('fetched');
    expect(await refsUnderRuns()).toEqual(['refs/runs/gone/spec', 'refs/runs/kept/spec']);

    await git(['push', '-q', 'origin', ':refs/runs/gone/spec'], other);
    const res = await request(app).post('/api/git/fetch');
    expect(res.body.status).toBe('fetched');
    expect(await refsUnderRuns()).toEqual(['refs/runs/kept/spec']);
  });

  it('[ac:ac-ref-refs-runs-przepisany-na-remote-ni] a refs/runs/* ref rewritten on the remote by a non-fast-forward equals the remote after fetched', async () => {
    fs.writeFileSync(path.join(other, 'page.md'), '# page (shadow v1)\n');
    await git(['commit', '-q', '-am', 'shadow v1'], other);
    const v1 = (await git(['rev-parse', 'HEAD'], other)).trim();
    await git(['push', '-q', 'origin', 'HEAD:refs/runs/run-1/spec'], other);
    const app = appFor(new GitService(work, [work]));
    expect((await request(app).post('/api/git/fetch')).body.status).toBe('fetched');
    expect((await git(['rev-parse', 'refs/runs/run-1/spec'], work)).trim()).toBe(v1);

    // Rewrite: the new tip does not descend from the old one.
    fs.writeFileSync(path.join(other, 'page.md'), '# page (shadow v2, rewritten)\n');
    await git(['commit', '-q', '--amend', '-am', 'shadow v2'], other);
    const v2 = (await git(['rev-parse', 'HEAD'], other)).trim();
    await git(['push', '-q', '--force', 'origin', 'HEAD:refs/runs/run-1/spec'], other);
    await expect(pexec('git', ['merge-base', '--is-ancestor', v1, v2], { cwd: other })).rejects.toBeTruthy();

    const res = await request(app).post('/api/git/fetch');
    expect(res.body.status).toBe('fetched');
    expect((await git(['rev-parse', 'refs/runs/run-1/spec'], work)).trim()).toBe(v2);
    expect((await git(['rev-parse', 'refs/runs/run-1/spec'], bare)).trim()).toBe(v2);
  });

  it('[ac:ac-fetch-z-wynikiem-fetched-nie-usuwa-lo] a fetch with result fetched does not remove a local ref outside refs/runs/* that the remote lacks', async () => {
    await git(['push', '-q', 'origin', 'HEAD:refs/heads/topic', 'HEAD:refs/runs/run-1/spec'], other);
    const app = appFor(new GitService(work, [work]));
    expect((await request(app).post('/api/git/fetch')).body.status).toBe('fetched');
    expect((await git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/topic'], work)).trim()).toBe(
      'refs/remotes/origin/topic',
    );
    // Local refs the remote never had, and a remote-tracking ref whose branch the remote then deletes.
    await git(['branch', 'local-only'], work);
    await git(['update-ref', 'refs/custom/keep', 'HEAD'], work);
    await git(['push', '-q', 'origin', ':refs/heads/topic', ':refs/runs/run-1/spec'], other);

    const res = await request(app).post('/api/git/fetch');
    expect(res.body.status).toBe('fetched');
    const refs = (await git(['for-each-ref', '--format=%(refname)'], work)).split('\n').filter(Boolean);
    expect(refs).toEqual(
      expect.arrayContaining(['refs/remotes/origin/topic', 'refs/heads/local-only', 'refs/custom/keep', 'refs/heads/main']),
    );
    // The pruning did run — inside refs/runs/ only.
    expect(await refsUnderRuns()).toEqual([]);
  });
});

/**
 * 2.1.46 (endpoint get-api-git-shadows, dto git-shadows-response, M28
 * dadc3w49) — `GET /api/git/shadows` against a real repository whose page
 * root is `pages/` (a release-flag root); `notes/` lies outside every root and
 * `.claude4spec/releases` is the releases root. Shadows are `refs/runs/*` refs
 * created locally — the same source the fetch fills.
 */
describe('GET /api/git/shadows (2.1.46)', () => {
  let work: string;
  let first: string;
  let n = 0;

  function appFor(svc: GitService): express.Express {
    return express().use(express.json()).use('/api/git', gitRouter(svc)).use(errorHandler);
  }

  function writeConfig(enabled: boolean): void {
    const dir = path.join(work, '.claude4spec');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify(
        { $schemaVersion: 4, name: 'test', roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }], git: { enabled } },
        null,
        2,
      ),
    );
  }

  const service = (): GitService => new GitService(work, [path.join(work, 'pages')]);

  async function commit(files: Record<string, string>, message: string): Promise<string> {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
      fs.writeFileSync(path.join(work, rel), content);
      await git(['add', '--', rel], work);
    }
    await git(['commit', '-q', '-m', message], work);
    return (await git(['rev-parse', 'HEAD'], work)).trim();
  }

  /** `refs/runs/<id>`: one commit with `files` on top of `from`; HEAD stays on `main`. */
  async function shadow(id: string, from: string, files: Record<string, string>, subject = `shadow ${id}`): Promise<string> {
    const tmp = `tmp-shadow-${++n}`;
    await git(['checkout', '-q', '-b', tmp, from], work);
    const tip = await commit(files, subject);
    await git(['update-ref', `refs/runs/${id}`, tip], work);
    await git(['checkout', '-q', 'main'], work);
    await git(['branch', '-q', '-D', tmp], work);
    return tip;
  }

  const ids = (body: { shadows: Array<{ id: string }> }): string[] => body.shadows.map((s) => s.id);

  beforeEach(async () => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-shadows-'));
    await initRepo(work);
    writeConfig(true);
    first = await commit({ 'pages/spec.md': '# spec v1\n', 'notes/outside.md': '# notes v1\n' }, 'first');
    await commit({ 'pages/other.md': '# other (main)\n' }, 'second');
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('[entity:get-api-git-shadows] [entity:git-shadows-response] [ac:ac-get-api-git-shadows-zwraca-ref-refs-r] returns a refs/runs/* ref that shares an ancestor with HEAD, is not its ancestor and changes a release root — 200 { shadows: [{ id, tipSha, tipCommittedAt, tipSubject }] }', async () => {
    const tip = await shadow('run-1/spec', first, { 'pages/spec.md': '# spec (shadow)\n' }, 'Shadow turn 1');
    const res = await request(appFor(service())).get('/api/git/shadows');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['shadows']);
    expect(Array.isArray(res.body.shadows)).toBe(true);
    expect(res.body.shadows).toEqual([
      {
        id: 'run-1/spec',
        tipSha: tip,
        tipCommittedAt: (await git(['log', '-1', '--format=%cI', tip], work)).trim(),
        tipSubject: 'Shadow turn 1',
      },
    ]);
    const [entry] = res.body.shadows;
    expect(Object.keys(entry).sort()).toEqual(['id', 'tipCommittedAt', 'tipSha', 'tipSubject']);
    for (const key of ['id', 'tipSha', 'tipCommittedAt', 'tipSubject']) expect(typeof entry[key]).toBe('string');
    expect(Number.isNaN(Date.parse(entry.tipCommittedAt))).toBe(false);
    expect(entry).not.toHaveProperty('current');
  });

  it('[ac:ac-get-api-git-shadows-nie-zwraca-refa-b] does not return a ref that is an ancestor of HEAD', async () => {
    await git(['update-ref', 'refs/runs/contained/spec', first], work);
    await shadow('run-1/spec', first, { 'pages/spec.md': '# spec (shadow)\n' });
    const res = await request(appFor(service())).get('/api/git/shadows');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(['run-1/spec']);
  });

  it('[ac:ac-get-api-git-shadows-nie-zwraca-refa-b-2] does not return a ref without a common ancestor with HEAD', async () => {
    await git(['checkout', '-q', '--orphan', 'unrelated'], work);
    await git(['rm', '-q', '-rf', '--cached', '.'], work);
    fs.mkdirSync(path.join(work, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(work, 'pages', 'spec.md'), '# spec (unrelated history)\n');
    await git(['add', 'pages/spec.md'], work);
    await git(['commit', '-q', '-m', 'unrelated root'], work);
    await git(['update-ref', 'refs/runs/unrelated/spec', 'HEAD'], work);
    await git(['checkout', '-q', '-f', 'main'], work);
    await git(['branch', '-q', '-D', 'unrelated'], work);
    await shadow('run-1/spec', first, { 'pages/spec.md': '# spec (shadow)\n' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await request(appFor(service())).get('/api/git/shadows');
      expect(res.status).toBe(200);
      expect(ids(res.body)).toEqual(['run-1/spec']);
      expect(warn.mock.calls.some((c) => String(c[0]).includes('unrelated/spec'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('[ac:ac-get-api-git-shadows-nie-zwraca-refa-k] does not return a ref whose diff from the base does not touch the release roots', async () => {
    await shadow('outside/spec', first, { 'notes/outside.md': '# notes (shadow)\n' });
    await shadow('releases-only/spec', first, { '.claude4spec/releases/v9.json': '{}\n' });
    await shadow('entities/spec', first, { '.claude4spec/entities/ac/x.json': '{}\n' });
    await shadow('run-1/spec', first, { 'pages/spec.md': '# spec (shadow)\n' });
    const res = await request(appFor(service())).get('/api/git/shadows');
    expect(res.status).toBe(200);
    // The entities root carries the `release` flag too; `notes/` and the releases root do not count.
    expect(ids(res.body)).toEqual(['entities/spec', 'run-1/spec']);
  });

  it('[entity:get-api-git-shadows] git off or no repository → 200 { shadows: [] }', async () => {
    await shadow('run-1/spec', first, { 'pages/spec.md': '# spec (shadow)\n' });
    writeConfig(false);
    const off = await request(appFor(service())).get('/api/git/shadows');
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ shadows: [] });

    const noRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-shadows-norepo-'));
    try {
      fs.mkdirSync(path.join(noRepo, 'pages'));
      writeConfigJson(noRepo, { enabled: true });
      const res = await request(appFor(new GitService(noRepo, [path.join(noRepo, 'pages')]))).get('/api/git/shadows');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ shadows: [] });
    } finally {
      fs.rmSync(noRepo, { recursive: true, force: true });
    }
  });
});

/**
 * 2.1.49 (endpoints get-api-git-status / get-api-git-branches, dtos
 * git-status-response / git-branches-response) — the two reads the `#git`
 * settings card and the header `GitStatusBadge` consume: method + path, the
 * documented 200 and the exact DTO shape (every required field, typed, nothing
 * else).
 */
describe('GET /api/git/status + GET /api/git/branches — the settings card and header reads (2.1.49)', () => {
  let base: string;
  let work: string;
  let bare: string;

  function appFor(svc: GitService): express.Express {
    return express().use(express.json()).use('/api/git', gitRouter(svc)).use(errorHandler);
  }

  beforeEach(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-reads-'));
    work = path.join(base, 'work');
    bare = path.join(base, 'remote.git');
    await pexec('git', ['init', '--bare', '-b', 'main', bare]);
    await initRepo(work);
    writeConfigJson(work, { enabled: true });
    fs.writeFileSync(path.join(work, 'page.md'), '# page v1\n');
    await git(['add', '-A'], work);
    await git(['commit', '-m', 'first'], work);
    await git(['remote', 'add', 'origin', bare], work);
    await git(['push', '-u', 'origin', 'main'], work);
    await git(['branch', 'feature'], work);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('[entity:get-api-git-status] [entity:git-status-response] GET /api/git/status → 200 with exactly the GitStatusResponse fields, each with its type', async () => {
    fs.writeFileSync(path.join(work, 'page.md'), '# page v2\n');
    const res = await request(appFor(new GitService(work, [work]))).get('/api/git/status');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['ahead', 'behind', 'branch', 'detected', 'isDirty', 'lastFetchedAt', 'remoteUrl', 'rootPath'].sort(),
    );
    expect(res.body.detected).toBe(true);
    expect(fs.realpathSync(res.body.rootPath)).toBe(fs.realpathSync(work));
    expect(res.body.remoteUrl).toBe(bare);
    expect(res.body.branch).toBe('main');
    expect(res.body.isDirty).toBe(true);
    expect(res.body.ahead).toBe(0);
    expect(res.body.behind).toBe(0);
    // `git push -u` alone never fetched: no FETCH_HEAD yet.
    expect(res.body.lastFetchedAt).toBeNull();
  });

  it('[entity:get-api-git-status] [entity:git-status-response] with the git master switch off GET /api/git/status still answers 200 with every field present', async () => {
    writeConfigJson(work, { enabled: false });
    const res = await request(appFor(new GitService(work, [work]))).get('/api/git/status');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['ahead', 'behind', 'branch', 'detected', 'isDirty', 'lastFetchedAt', 'remoteUrl', 'rootPath'].sort(),
    );
    expect(typeof res.body.detected).toBe('boolean');
    expect(typeof res.body.isDirty).toBe('boolean');
    // ahead/behind need the master switch: `null` while it is off.
    expect(res.body.ahead).toBeNull();
    expect(res.body.behind).toBeNull();
  });

  it('[entity:get-api-git-branches] [entity:git-branches-response] GET /api/git/branches → 200 { current, branches } with the current branch and the local branches only', async () => {
    const app = appFor(new GitService(work, [work]));
    const res = await request(app).get('/api/git/branches');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['branches', 'current']);
    expect(res.body.current).toBe('main');
    expect([...res.body.branches].sort()).toEqual(['feature', 'main']);
    // Local branches only — no remote-tracking `origin/*`.
    expect(res.body.branches.some((b: string) => b.startsWith('origin/'))).toBe(false);
  });

  it('[entity:get-api-git-branches] [entity:git-branches-response] [ac:ac-get-api-git-branches-zwraca-current] on a branch → current + the local branches; detached HEAD → current null with a non-empty list; master switch off or no repository (listBranches() null) → current null with an empty list (always 200)', async () => {
    const onBranch = await request(appFor(new GitService(work, [work]))).get('/api/git/branches');
    expect(onBranch.status).toBe(200);
    expect(onBranch.body.current).toBe('main');
    expect([...onBranch.body.branches].sort()).toEqual(['feature', 'main']);

    const head = (await git(['rev-parse', 'HEAD'], work)).trim();
    await git(['checkout', head], work);
    const detached = await request(appFor(new GitService(work, [work]))).get('/api/git/branches');
    expect(detached.status).toBe(200);
    expect(detached.body.current).toBeNull();
    expect([...detached.body.branches].sort()).toEqual(['feature', 'main']);

    writeConfigJson(work, { enabled: false });
    const off = await request(appFor(new GitService(work, [work]))).get('/api/git/branches');
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ current: null, branches: [] });

    const plain = path.join(base, 'plain');
    fs.mkdirSync(plain);
    writeConfigJson(plain, { enabled: true });
    const noRepo = await request(appFor(new GitService(plain, [plain]))).get('/api/git/branches');
    expect(noRepo.status).toBe(200);
    expect(noRepo.body).toEqual({ current: null, branches: [] });
  });
});

/**
 * 2.1.49 (endpoint get-api-git-status) — the edge cases of the repository
 * probe behind `GET /api/git/status`: no `git` binary, no repository, and roots
 * of kind `pages` outside the worktree. The probe never throws; "no repository"
 * is `detected: false` (the `null` of the M28 contract), always with 200.
 */
describe('GET /api/git/status — detection edge cases (2.1.49)', () => {
  let base: string;
  let work: string;

  function appFor(svc: GitService): express.Express {
    return express().use(express.json()).use('/api/git', gitRouter(svc)).use(errorHandler);
  }

  beforeEach(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-detect-'));
    work = path.join(base, 'work');
    await initRepo(work);
    writeConfigJson(work, { enabled: true });
    fs.mkdirSync(path.join(work, 'pages'));
    fs.writeFileSync(path.join(work, 'seed.txt'), 'seed');
    await git(['add', 'seed.txt'], work);
    await git(['commit', '-m', 'seed'], work);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('[ac:ac-detect-przy-braku-git-w-path-lub] without `git` in PATH (and without a repository) detect() resolves to detected: false without throwing, and GET /api/git/status answers 200 with the not-detected payload', async () => {
    const svc = new GitService(work, [path.join(work, 'pages')]);
    expect((await svc.detect()).detected).toBe(true); // the repository is there…

    const savedPath = process.env.PATH;
    const emptyBin = path.join(base, 'empty-bin');
    fs.mkdirSync(emptyBin);
    process.env.PATH = emptyBin; // …but no `git` binary can be found
    try {
      await expect(svc.detect()).resolves.toMatchObject({ detected: false, rootPath: null });
      const res = await request(appFor(svc)).get('/api/git/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        detected: false,
        rootPath: null,
        remoteUrl: null,
        branch: null,
        isDirty: false,
        ahead: null,
        behind: null,
        lastFetchedAt: null,
      });
    } finally {
      process.env.PATH = savedPath;
    }

    // No repository at all (git present): the same answer.
    const plain = path.join(base, 'plain');
    fs.mkdirSync(path.join(plain, 'pages'), { recursive: true });
    writeConfigJson(plain, { enabled: true });
    const noRepo = new GitService(plain, [path.join(plain, 'pages')]);
    await expect(noRepo.detect()).resolves.toMatchObject({ detected: false, rootPath: null });
    const res = await request(appFor(noRepo)).get('/api/git/status');
    expect(res.status).toBe(200);
    expect(res.body.detected).toBe(false);
    expect(res.body.rootPath).toBeNull();
  });

  it('[ac:ac-gdy-wszystkie-releasable-roota-leza-poza] every `pages` root outside the worktree → not detected (no repository, no commit); some inside, some outside → detected, the outside ones skipped with a log and the commit covers the roots inside', async () => {
    const outside = path.join(base, 'outside-pages'); // a sibling of the worktree, in no repository
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'ext.md'), '# outside\n');

    // All `pages` roots outside the worktree: treated as no repository.
    const allOutside = new GitService(work, [outside]);
    const none = await request(appFor(allOutside)).get('/api/git/status');
    expect(none.status).toBe(200);
    expect(none.body.detected).toBe(false);
    expect(none.body.rootPath).toBeNull();
    expect(await allOutside.commitOnRelease({ name: 'v0', description: 'nothing' })).toBeNull();
    expect((await git(['rev-list', '--count', 'HEAD'], work)).trim()).toBe('1');

    // One root outside (listed first), one inside: the inside one is detected.
    fs.writeFileSync(path.join(work, 'pages', 'a.md'), '# a\n');
    const mixed = new GitService(work, [outside, path.join(work, 'pages')]);
    const some = await request(appFor(mixed)).get('/api/git/status');
    expect(some.status).toBe(200);
    expect(some.body.detected).toBe(true);
    expect(fs.realpathSync(some.body.rootPath)).toBe(fs.realpathSync(work));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await mixed.commitOnRelease({ name: 'v1', description: 'first cut' });
      expect(result?.status).toBe('committed');
      expect(warn.mock.calls.some((c) => String(c[0]).includes(outside) && String(c[0]).includes('outside the repository'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
    const tracked = (await git(['ls-tree', '-r', '--name-only', 'HEAD'], work)).split('\n');
    expect(tracked).toContain('pages/a.md');
    expect(tracked.some((t) => t.includes('ext.md'))).toBe(false);
  });
});

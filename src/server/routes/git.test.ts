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
});

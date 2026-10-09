import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitRepoLock, GitService } from './git.js';
import { ProjectWsEmitter } from '../ws/project-emitter.js';
import type { WsGateway } from '../ws/gateway.js';

/**
 * 2.1.10 (M28 ezudoqef) — one lock per repository over every `.git`-writing
 * operation: release-driven operations wait, sidebar operations answer `busy`;
 * and (M49 7xmafzkd) `git:status-changed` after a release commit.
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

/**
 * An HTTP "remote" whose first answer is held back `delayMs` — keeps a
 * `git fetch` (and so the repository lock) in flight long enough to race it.
 * `hit` resolves once git's first request arrived, i.e. the fetch holds the lock.
 */
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

describe('GitRepoLock', () => {
  it('run() waits for the holder; tryRun() refuses while held, including during the hand-off to a waiter', async () => {
    const lock = new GitRepoLock();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = lock.run(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = () => {
            order.push('first');
            resolve();
          };
        }),
    );
    const second = lock.run(async () => {
      order.push('second');
    });
    expect(lock.isHeld).toBe(true);
    expect(lock.tryRun(async () => 'sidebar')).toBeNull();
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
    expect(lock.isHeld).toBe(false);
    await expect(lock.tryRun(async () => 'sidebar')).resolves.toBe('sidebar');
  });
});

describe('GitService — repository lock and git:status-changed (2.1.10)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-lock-'));
    await initRepo(dir);
    writeConfigJson(dir, { enabled: true });
    fs.writeFileSync(path.join(dir, 'page.md'), '# v1\n');
    await git(['add', 'page.md'], dir);
    await git(['commit', '-m', 'first'], dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function trackSlowUpstream(url: string): Promise<void> {
    await git(['remote', 'add', 'origin', url], dir);
    await git(['config', 'branch.main.remote', 'origin'], dir);
    await git(['config', 'branch.main.merge', 'refs/heads/main'], dir);
  }

  it('[ac:ac-commit-wydania-uruchomiony-w-trakcie] a release commit started during a fetch waits for it to finish and ends committed', async () => {
    const remote = await slowRemote(1500);
    try {
      await trackSlowUpstream(remote.url);
      const svc = new GitService(dir, [dir]);
      const finished: string[] = [];

      const fetchP = svc.fetch().then((r) => {
        finished.push('fetch');
        return r;
      });
      await remote.hit; // the fetch is in flight and holds the repository lock

      fs.writeFileSync(path.join(dir, 'page.md'), '# v2\n');
      const headBefore = (await git(['rev-parse', 'HEAD'], dir)).trim();
      const commitP = svc.commitOnRelease({ name: 'v2', description: '' }).then((r) => {
        finished.push('commit');
        return r;
      });

      const [fetchResult, commitResult] = await Promise.all([fetchP, commitP]);
      expect(finished).toEqual(['fetch', 'commit']); // the commit waited — it did not refuse
      expect(fetchResult.status).toBe('error'); // the slow remote answers 404
      expect(commitResult?.status).toBe('committed');
      expect((await git(['rev-parse', 'HEAD'], dir)).trim()).not.toBe(headBefore);
      expect((await git(['log', '-1', '--format=%s'], dir)).trim()).toBe('v2');
    } finally {
      await remote.close();
    }
  }, 30_000);

  it('[entity:git-fetch-response] a sidebar operation (fetch, checkout) during a running fetch answers busy (fetch: message null)', async () => {
    const remote = await slowRemote(1500);
    try {
      await trackSlowUpstream(remote.url);
      await git(['branch', 'other'], dir);
      const svc = new GitService(dir, [dir]);
      const fetchP = svc.fetch();
      await remote.hit;

      // [entity:git-fetch-response] `message` is git's text on `error` only; `null` on `busy`.
      expect(await svc.fetch()).toEqual({
        status: 'busy',
        ahead: null,
        behind: null,
        message: null,
      });
      expect((await svc.checkout('other')).status).toBe('busy');
      await fetchP;
      // Lock released — the sidebar operation goes through again.
      expect((await svc.checkout('other')).status).toBe('switched');
    } finally {
      await remote.close();
    }
  }, 30_000);

  it('[ac:ac-po-commicie-wydania-serwer-emituje-do] after a release commit the server emits git:status-changed to the project room', async () => {
    const gateway = { broadcast: vi.fn() };
    const ws = new ProjectWsEmitter(gateway as unknown as WsGateway, 'proj-1');
    const svc = new GitService(dir, [dir], () => false, ws);
    fs.writeFileSync(path.join(dir, 'page.md'), '# v2\n');

    const result = await svc.commitOnRelease({ name: 'v2', description: 'second' });
    expect(result?.status).toBe('committed');
    // A 'current'-mode commit moved HEAD of the current branch.
    expect(gateway.broadcast).toHaveBeenCalledWith('proj-1', { kind: 'git:status-changed', headChanged: true });
  });

  it('emits nothing when the release commit has nothing to commit', async () => {
    const gateway = { broadcast: vi.fn() };
    const svc = new GitService(dir, [dir], () => false, new ProjectWsEmitter(gateway as unknown as WsGateway, 'p'));
    await git(['add', '-A'], dir);
    await git(['commit', '-m', 'everything'], dir);
    const result = await svc.commitOnRelease({ name: 'v2', description: '' });
    expect(result?.status).toBe('nothing-to-commit');
    expect(gateway.broadcast).not.toHaveBeenCalled();
  });
});

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { GitService, PUBLISH_FILE_SUBJECT, sanitizeRemoteUrl } from './git.js';
import type { GitErrorRecovery, GitPublishResult, GitUpstreamPathResult } from '../../shared/git.js';
import { ProjectWsEmitter } from '../ws/project-emitter.js';
import type { WsGateway } from '../ws/gateway.js';

/**
 * 2.1.64 (M28) — the three primitives for handing work to another machine:
 * `checkPathOnUpstream` (xp56ebqc), `publishFile` (ejwze5r4) and
 * `workspaceHomePath` (tmrix8ji). Real repositories: a working clone `dir`
 * whose `main` tracks `origin/main` in a bare repository `bare`.
 */

const pexec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd });
  return stdout;
}

async function configureUser(dir: string): Promise<void> {
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

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('GitService contract (git-service-contract, 2.1.64 additions)', () => {
  it('git-service-contract: checkPathOnUpstream / publishFile / workspaceHomePath signatures and result types', () => {
    expectTypeOf<GitService['checkPathOnUpstream']>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<GitService['checkPathOnUpstream']>().returns.resolves.toEqualTypeOf<GitUpstreamPathResult>();
    // ASSUMPTION:dev-0008 — an optional origin thread beyond the snippet's `publishFile(path)`.
    expectTypeOf<GitService['publishFile']>().parameters.toEqualTypeOf<[string, { threadId?: string | null }?]>();
    expectTypeOf<GitService['publishFile']>().returns.resolves.toEqualTypeOf<GitPublishResult>();
    expectTypeOf<GitService['workspaceHomePath']>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<GitService['workspaceHomePath']>().returns.resolves.toEqualTypeOf<string | null>();

    expectTypeOf<GitUpstreamPathResult>().toEqualTypeOf<
      | { status: 'on-upstream'; remote: string; branch: string; tipSha: string }
      | { status: 'skipped' }
      | { status: 'no-upstream' }
      | { status: 'busy' }
      | { status: 'path-dirty' }
      | { status: 'path-differs' }
      | { status: 'error'; message: string }
    >();
    expectTypeOf<GitPublishResult>().toEqualTypeOf<
      | { status: 'published'; sha: string; branch: string }
      | { status: 'nothing-to-publish' }
      | { status: 'skipped' }
      | { status: 'no-upstream' }
      | { status: 'busy' }
      | { status: 'error'; message: string; recovery: GitErrorRecovery }
    >();
  });
});

describe('sanitizeRemoteUrl (M28 xp56ebqc "Oczyszczony remote")', () => {
  it('http(s) loses the whole userinfo', () => {
    expect(sanitizeRemoteUrl('https://user:token@github.com/org/repo.git')).toBe('https://github.com/org/repo.git');
    expect(sanitizeRemoteUrl('https://token@github.com/org/repo.git')).toBe('https://github.com/org/repo.git');
    expect(sanitizeRemoteUrl('http://a:b@host:8080/r')).toBe('http://host:8080/r');
    expect(sanitizeRemoteUrl('https://github.com/org/repo.git')).toBe('https://github.com/org/repo.git');
  });

  it('SSH keeps the user and loses the password', () => {
    expect(sanitizeRemoteUrl('ssh://git:secret@host.example/org/repo.git')).toBe('ssh://git@host.example/org/repo.git');
    expect(sanitizeRemoteUrl('ssh://git@host.example:2222/org/repo.git')).toBe('ssh://git@host.example:2222/org/repo.git');
    expect(sanitizeRemoteUrl('git@github.com:org/repo.git')).toBe('git@github.com:org/repo.git');
    expect(sanitizeRemoteUrl('git:secret@github.com:org/repo.git')).toBe('git@github.com:org/repo.git');
  });

  it('a local path is returned as it is', () => {
    expect(sanitizeRemoteUrl('/srv/git/repo.git')).toBe('/srv/git/repo.git');
  });
});

describe('GitService — remote-run primitives (2.1.64)', () => {
  let tmp: string;
  let bare: string;
  let dir: string;

  beforeEach(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-remote-run-')));
    bare = path.join(tmp, 'remote.git');
    dir = path.join(tmp, 'work');
    await pexec('git', ['init', '--bare', '-b', 'main', bare]);
    fs.mkdirSync(dir);
    await git(['init', '-b', 'main'], dir);
    await configureUser(dir);
    writeConfigJson(dir, { enabled: true });
    write(dir, 'pages/brief.md', '# brief v1\n');
    write(dir, 'pages/other.md', '# other v1\n');
    await git(['add', '-A'], dir);
    await git(['commit', '-m', 'init'], dir);
    await git(['remote', 'add', 'origin', bare], dir);
    await git(['push', '-u', 'origin', 'main'], dir);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** A second clone of `bare` that pushes a commit changing `rel`; returns the new remote tip. */
  async function pushFromOtherClone(rel: string, content: string): Promise<string> {
    const other = path.join(tmp, `other-${Math.random().toString(36).slice(2)}`);
    await pexec('git', ['clone', bare, other]);
    await configureUser(other);
    write(other, rel, content);
    await git(['add', '-A'], other);
    await git(['commit', '-m', `other: ${rel}`], other);
    await git(['push', 'origin', 'main'], other);
    return (await git(['rev-parse', 'HEAD'], other)).trim();
  }

  describe('checkPathOnUpstream(path)', () => {
    it('[ac:ac-sprawdzenie-sciezki-zwraca-sha-tipu-u] returns the upstream tip sha when the path has the same blob on HEAD and the upstream tip', async () => {
      // HEAD is ahead of the upstream in ANOTHER file — one blob is compared, not the tree.
      write(dir, 'pages/other.md', '# other v2\n');
      await git(['commit', '-am', 'local other'], dir);
      const svc = new GitService(dir, [dir]);

      const result = await svc.checkPathOnUpstream('pages/brief.md');

      const remoteTip = (await git(['rev-parse', 'main'], bare)).trim();
      expect(result).toEqual({ status: 'on-upstream', remote: bare, branch: 'main', tipSha: remoteTip });
      if (result.status !== 'on-upstream') throw new Error('unreachable');
      expect(result.tipSha).toMatch(/^[0-9a-f]{40}$/);
      expect(result.tipSha).not.toBe((await git(['rev-parse', 'HEAD'], dir)).trim());
    });

    it('fetches first: a tip pushed by someone else in another file is the tip returned', async () => {
      const newTip = await pushFromOtherClone('pages/other.md', '# other remote\n');
      const svc = new GitService(dir, [dir]);
      const result = await svc.checkPathOnUpstream('pages/brief.md');
      expect(result).toMatchObject({ status: 'on-upstream', tipSha: newTip });
    });

    it('[ac:ac-remote-zwracany-przez-sprawdzenie-sci] the remote returned for an http(s) upstream carries no userinfo', async () => {
      const svc = new GitService(dir, [dir]);
      // The real fetch already populated origin/main; the remote now points at an
      // http(s) address with credentials, and the network step is stubbed.
      await git(['fetch', 'origin'], dir);
      await git(['remote', 'set-url', 'origin', 'https://alice:s3cr3t-token@git.example.com/org/spec.git'], dir);
      vi.spyOn(svc as unknown as { gitNetwork: () => Promise<unknown> }, 'gitNetwork').mockResolvedValue({
        stdout: '',
        stderr: '',
      });

      const result = await svc.checkPathOnUpstream('pages/brief.md');

      expect(result).toMatchObject({ status: 'on-upstream', remote: 'https://git.example.com/org/spec.git' });
      if (result.status !== 'on-upstream') throw new Error('unreachable');
      expect(result.remote).not.toContain('alice');
      expect(result.remote).not.toContain('s3cr3t-token');
      expect(result.remote).not.toContain('@');
      // detect()'s remoteUrl stays raw.
      expect((await svc.detect()).remoteUrl).toBe('https://alice:s3cr3t-token@git.example.com/org/spec.git');
    });

    it('[ac:ac-sciezka-zmieniona-lokalnie-daje-path] a path changed locally gives path-dirty (working tree, index, untracked)', async () => {
      const svc = new GitService(dir, [dir]);

      write(dir, 'pages/brief.md', '# brief edited\n');
      expect(await svc.checkPathOnUpstream('pages/brief.md')).toEqual({ status: 'path-dirty' });

      await git(['add', 'pages/brief.md'], dir);
      expect(await svc.checkPathOnUpstream('pages/brief.md')).toEqual({ status: 'path-dirty' });

      write(dir, 'pages/new.md', '# new\n');
      expect(await svc.checkPathOnUpstream('pages/new.md')).toEqual({ status: 'path-dirty' });

      // A change in another file does not make this path dirty.
      expect(await svc.checkPathOnUpstream('pages/other.md')).toMatchObject({ status: 'on-upstream' });
    });

    it('path-differs when the blob on HEAD and on the upstream tip differ, or the file is missing on one side', async () => {
      const svc = new GitService(dir, [dir]);
      write(dir, 'pages/brief.md', '# brief local v2\n');
      await git(['commit', '-am', 'local brief'], dir);
      expect(await svc.checkPathOnUpstream('pages/brief.md')).toEqual({ status: 'path-differs' });

      write(dir, 'pages/only-local.md', '# local\n');
      await git(['add', '-A'], dir);
      await git(['commit', '-m', 'only local'], dir);
      expect(await svc.checkPathOnUpstream('pages/only-local.md')).toEqual({ status: 'path-differs' });
      expect(await svc.checkPathOnUpstream('pages/nowhere.md')).toEqual({ status: 'path-differs' });
    });

    it('gate and guards: skipped (git off), no-upstream, busy (lock taken), error (fetch fails)', async () => {
      writeConfigJson(dir, { enabled: false });
      expect(await new GitService(dir, [dir]).checkPathOnUpstream('pages/brief.md')).toEqual({ status: 'skipped' });
      writeConfigJson(dir, { enabled: true });

      const svc = new GitService(dir, [dir]);
      let inner: unknown;
      await svc.tryWithRepoLock(async () => {
        inner = await svc.checkPathOnUpstream('pages/brief.md');
      });
      expect(inner).toEqual({ status: 'busy' });

      await git(['remote', 'set-url', 'origin', path.join(tmp, 'missing.git')], dir);
      const err = await svc.checkPathOnUpstream('pages/brief.md');
      expect(err.status).toBe('error');

      await git(['branch', '--unset-upstream'], dir);
      expect(await svc.checkPathOnUpstream('pages/brief.md')).toEqual({ status: 'no-upstream' });
    });
  });

  describe('publishFile(path)', () => {
    it('[ac:ac-publikacja-pliku-commituje-wylacznie] commits only the given path; other index and working-tree changes stay untouched', async () => {
      write(dir, 'pages/brief.md', '# brief to publish\n');
      write(dir, 'pages/other.md', '# other staged\n');
      await git(['add', 'pages/other.md'], dir);
      write(dir, 'pages/unstaged.md', '# untracked\n');
      const svc = new GitService(dir, [dir]);

      const result = await svc.publishFile('pages/brief.md');

      const head = (await git(['rev-parse', 'HEAD'], dir)).trim();
      expect(result).toEqual({ status: 'published', sha: head, branch: 'main' });
      // The commit carries exactly the one path, with the fixed subject and the path in its body.
      const files = (await git(['show', '--name-only', '--format=', 'HEAD'], dir)).trim().split('\n');
      expect(files).toEqual(['pages/brief.md']);
      expect((await git(['log', '-1', '--format=%s'], dir)).trim()).toBe(PUBLISH_FILE_SUBJECT);
      expect((await git(['log', '-1', '--format=%b'], dir)).trim()).toBe('pages/brief.md');
      // The other staged change is still staged, the untracked file still untracked.
      expect((await git(['diff', '--cached', '--name-only'], dir)).trim()).toBe('pages/other.md');
      expect(fs.readFileSync(path.join(dir, 'pages/other.md'), 'utf8')).toBe('# other staged\n');
      expect(await git(['status', '--porcelain', '--', 'pages/unstaged.md'], dir)).toContain('?? pages/unstaged.md');
      // Pushed: the upstream's tip is the publication commit.
      expect((await git(['rev-parse', 'main'], bare)).trim()).toBe(head);
    });

    it('publishes a new, untracked file', async () => {
      write(dir, 'pages/fresh.md', '# fresh\n');
      const svc = new GitService(dir, [dir]);
      const result = await svc.publishFile('pages/fresh.md');
      expect(result).toMatchObject({ status: 'published', branch: 'main' });
      expect((await git(['show', '--name-only', '--format=', 'HEAD'], dir)).trim()).toBe('pages/fresh.md');
      expect((await git(['rev-parse', 'main'], bare)).trim()).toBe((await git(['rev-parse', 'HEAD'], dir)).trim());
    });

    it('the publication commit emits git:status-changed with headChanged: true (the current branch HEAD moved)', async () => {
      write(dir, 'pages/brief.md', '# brief to publish\n');
      const gateway = { broadcast: vi.fn() };
      const svc = new GitService(dir, [dir], () => false, new ProjectWsEmitter(gateway as unknown as WsGateway, 'proj-1'));

      const result = await svc.publishFile('pages/brief.md');

      expect(result.status).toBe('published');
      expect(gateway.broadcast).toHaveBeenCalledWith('proj-1', { kind: 'git:status-changed', headChanged: true });
    });

    it('a publication asked for by an agent thread carries its threadId on git:status-changed', async () => {
      write(dir, 'pages/brief.md', '# brief to publish\n');
      const gateway = { broadcast: vi.fn() };
      const svc = new GitService(dir, [dir], () => false, new ProjectWsEmitter(gateway as unknown as WsGateway, 'proj-1'));

      const result = await svc.publishFile('pages/brief.md', { threadId: 'thread-7' });

      expect(result.status).toBe('published');
      expect(gateway.broadcast).toHaveBeenCalledWith('proj-1', {
        kind: 'git:status-changed',
        headChanged: true,
        threadId: 'thread-7',
      });
    });

    it('[ac:ac-push-publikacji-odrzucony-jako-non-fa] a non-fast-forward rejection gives an error status and no sync follows', async () => {
      const remoteTip = await pushFromOtherClone('pages/other.md', '# other from elsewhere\n');
      write(dir, 'pages/brief.md', '# brief local\n');
      const svc = new GitService(dir, [dir]);
      const syncSpy = vi.spyOn(svc, 'sync');

      const result = await svc.publishFile('pages/brief.md');

      // 1. error status, recovery kind non-fast-forward.
      expect(result.status).toBe('error');
      if (result.status !== 'error') throw new Error('unreachable');
      expect(result.recovery.kind).toBe('non-fast-forward');
      expect(result.recovery.operation).toBe('push');
      // 2. no synchronization: sync() not called, HEAD is still the local
      // publication commit, the remote tip was not merged or rebased in.
      expect(syncSpy).not.toHaveBeenCalled();
      expect((await git(['log', '-1', '--format=%s'], dir)).trim()).toBe(PUBLISH_FILE_SUBJECT);
      await expect(git(['merge-base', '--is-ancestor', remoteTip, 'HEAD'], dir)).rejects.toThrow();
      expect((await git(['rev-parse', 'main'], bare)).trim()).toBe(remoteTip);
      expect(fs.readFileSync(path.join(dir, 'pages/other.md'), 'utf8')).toBe('# other v1\n');
    });

    it('a file unchanged against HEAD gives a push alone; nothing ahead → nothing-to-publish', async () => {
      const svc = new GitService(dir, [dir]);
      expect(await svc.publishFile('pages/brief.md')).toEqual({ status: 'nothing-to-publish' });

      write(dir, 'pages/other.md', '# other local\n');
      await git(['commit', '-am', 'local unpushed'], dir);
      const headBefore = (await git(['rev-parse', 'HEAD'], dir)).trim();
      const result = await svc.publishFile('pages/brief.md');
      expect(result).toEqual({ status: 'published', sha: headBefore, branch: 'main' });
      expect((await git(['rev-parse', 'HEAD'], dir)).trim()).toBe(headBefore);
      expect((await git(['rev-parse', 'main'], bare)).trim()).toBe(headBefore);
    });

    it('gate and guards: skipped (git off), no-upstream, busy (lock taken, no wait)', async () => {
      write(dir, 'pages/brief.md', '# changed\n');
      writeConfigJson(dir, { enabled: false });
      expect(await new GitService(dir, [dir]).publishFile('pages/brief.md')).toEqual({ status: 'skipped' });
      writeConfigJson(dir, { enabled: true });

      const svc = new GitService(dir, [dir]);
      let inner: unknown;
      await svc.tryWithRepoLock(async () => {
        inner = await svc.publishFile('pages/brief.md');
      });
      expect(inner).toEqual({ status: 'busy' });

      await git(['branch', '--unset-upstream'], dir);
      expect(await svc.publishFile('pages/brief.md')).toEqual({ status: 'no-upstream' });
      // Nothing was committed by any refusal.
      expect((await git(['log', '-1', '--format=%s'], dir)).trim()).toBe('init');
    });
  });

  describe('workspaceHomePath(home)', () => {
    it('[ac:ac-home-rowne-rootpath-daje] home equal to rootPath gives "."', async () => {
      const svc = new GitService(dir, [dir]);
      expect((await svc.detect()).rootPath).toBe(dir);
      expect(await svc.workspaceHomePath(dir)).toBe('.');
    });

    it('a home inside the repository gives its relative path; outside or without a repository → null', async () => {
      const svc = new GitService(dir, [dir]);
      fs.mkdirSync(path.join(dir, 'specs', 'app'), { recursive: true });
      expect(await svc.workspaceHomePath(path.join(dir, 'specs', 'app'))).toBe('specs/app');
      expect(await svc.workspaceHomePath(tmp)).toBeNull();

      const noRepo = path.join(tmp, 'plain');
      fs.mkdirSync(noRepo);
      expect(await new GitService(noRepo, [noRepo]).workspaceHomePath(noRepo)).toBeNull();
    });
  });
});

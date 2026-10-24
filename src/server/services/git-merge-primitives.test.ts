import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitRepoLock, GitService, type GitLockHandle } from './git.js';

/**
 * 2.1.47 (M28 ezudoqef / es9w55mr / aqys9dje / eu1rffp6) — the git layer under
 * the repository lock WITH A HANDLE, and the primitives of the shadow
 * acceptance (`pendingChanges`, `mergeIntoIndex`, `abortMerge`, the release
 * commit with `MERGE_HEAD` open), against real temporary repositories.
 */

const pexec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd });
  return stdout;
}

function writeConfigJson(cwd: string, gitCfg: Record<string, unknown>): void {
  const dir = path.join(cwd, '.claude4spec');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify(
      { $schemaVersion: 4, name: 'test', roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }], git: gitCfg },
      null,
      2,
    ),
  );
}

// Isolate from the developer's global/system git config (hooks, merge settings).
const savedEnv: Record<string, string | undefined> = {};
let emptyGlobalConfig: string;
beforeAll(() => {
  emptyGlobalConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-gitcfg-')), 'gitconfig');
  fs.writeFileSync(emptyGlobalConfig, '');
  for (const [k, v] of Object.entries({ GIT_CONFIG_GLOBAL: emptyGlobalConfig, GIT_CONFIG_NOSYSTEM: '1' })) {
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

describe('GitRepoLock — handle (2.1.47)', () => {
  it('[section:ezudoqef] taking the lock hands out a handle that is live only while its holder runs; a waiter gets its own handle', async () => {
    const lock = new GitRepoLock();
    let firstHandle: GitLockHandle | undefined;
    let secondHandle: GitLockHandle | undefined;
    let releaseFirst!: () => void;
    const first = lock.run(
      (h) =>
        new Promise<void>((resolve) => {
          firstHandle = h;
          releaseFirst = resolve;
        }),
    );
    const second = lock.run(async (h) => {
      secondHandle = h;
      // The previous holder's handle opens nothing any more.
      expect(lock.holds(firstHandle)).toBe(false);
      expect(lock.holds(h)).toBe(true);
    });
    expect(lock.holds(firstHandle)).toBe(true);
    expect(lock.holds(undefined)).toBe(false);
    // Not reentrant: a second take while held refuses (tryRun) — only the handle opens the held lock.
    expect(lock.tryRun(async () => 'again')).toBeNull();
    releaseFirst();
    await Promise.all([first, second]);
    expect(secondHandle).toBeDefined();
    expect(secondHandle).not.toBe(firstHandle);
    expect(lock.holds(secondHandle)).toBe(false);
    expect(lock.isHeld).toBe(false);
  });
});

describe('GitService — merge primitives of the shadow acceptance (2.1.47)', () => {
  let dir: string;
  let svc: GitService;
  const pages = (): string => path.join(dir, 'pages');
  /** The repository root as git reports it (a realpath — macOS tmpdir is a symlink). */
  const root = (): string => fs.realpathSync(dir);
  /** Repository-relative paths as ABSOLUTE ones against the root — the form `changedPaths` takes. */
  const abs = (...rels: string[]): string[] => rels.map((p) => path.join(root(), p));
  const sha = async (ref: string): Promise<string> => (await git(['rev-parse', ref], dir)).trim();
  const mergeHead = async (): Promise<string | null> =>
    pexec('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: dir })
      .then((r) => r.stdout.trim())
      .catch(() => null);

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-merge-'));
    await git(['init', '-q', '-b', 'main'], dir);
    await git(['config', 'user.email', 'test@example.com'], dir);
    await git(['config', 'user.name', 'Test'], dir);
    writeConfigJson(dir, { enabled: true });
    fs.mkdirSync(pages(), { recursive: true });
    fs.writeFileSync(path.join(pages(), 'a.md'), '# a\n\nline 1\n');
    fs.writeFileSync(path.join(pages(), 'b.md'), '# b\n');
    fs.writeFileSync(path.join(dir, 'outside.txt'), 'outside\n');
    await git(['add', '-A'], dir);
    await git(['commit', '-q', '-m', 'seed'], dir);
    svc = new GitService(dir, [pages()]);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A shadow ref: a branch off main with `files` committed; main checked out again. Returns its tip. */
  async function shadowWith(files: Record<string, string>): Promise<string> {
    await git(['checkout', '-q', '-b', 'shadow-src', 'main'], dir);
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      await git(['add', rel], dir);
    }
    await git(['commit', '-q', '-m', 'shadow turn'], dir);
    const tip = await sha('HEAD');
    await git(['checkout', '-q', 'main'], dir);
    await git(['branch', '-q', '-D', 'shadow-src'], dir);
    await git(['update-ref', 'refs/runs/run-1/spec', tip], dir);
    return tip;
  }

  describe('[section:es9w55mr] pendingChanges(pathspecs)', () => {
    it('lists modified tracked, staged and new untracked files inside the pathspecs, plus files staged anywhere in the repository; clean otherwise', async () => {
      expect(await svc.pendingChanges([pages()])).toEqual({ status: 'clean' });

      fs.writeFileSync(path.join(pages(), 'a.md'), '# a edited\n'); // modified tracked
      fs.writeFileSync(path.join(pages(), 'b.md'), '# b staged\n');
      await git(['add', 'pages/b.md'], dir); // staged
      fs.writeFileSync(path.join(pages(), 'new.md'), '# new\n'); // untracked, inside
      fs.writeFileSync(path.join(dir, 'outside.txt'), 'outside edited\n'); // modified, outside, NOT staged
      fs.writeFileSync(path.join(dir, 'loose.txt'), 'loose\n'); // untracked outside
      expect(await svc.pendingChanges([pages()])).toEqual({
        status: 'dirty',
        paths: ['pages/a.md', 'pages/b.md', 'pages/new.md'],
      });

      // Someone else's staged file outside the roots would ride in the merge commit → listed too.
      await git(['add', 'outside.txt'], dir);
      expect(await svc.pendingChanges([pages()])).toEqual({
        status: 'dirty',
        paths: ['outside.txt', 'pages/a.md', 'pages/b.md', 'pages/new.md'],
      });
    });

    it('is stricter than checkout(): an untracked file alone makes it dirty', async () => {
      fs.writeFileSync(path.join(pages(), 'only-untracked.md'), '# u\n');
      expect(await svc.pendingChanges([pages()])).toEqual({ status: 'dirty', paths: ['pages/only-untracked.md'] });
    });

    it('gate: git off → skipped; detached HEAD → no-branch; lock taken without its handle → busy, with the handle → runs', async () => {
      await git(['checkout', '-q', '--detach'], dir);
      expect(await svc.pendingChanges([pages()])).toEqual({ status: 'no-branch' });
      await git(['checkout', '-q', 'main'], dir);

      const inside = await svc.tryWithRepoLock(async (lock) => ({
        without: await svc.pendingChanges([pages()]),
        withHandle: await svc.pendingChanges([pages()], { root: root(), lock }),
      }));
      expect(inside).toEqual({ without: { status: 'busy' }, withHandle: { status: 'clean' } });

      writeConfigJson(dir, { enabled: false });
      expect(await svc.pendingChanges([pages()])).toEqual({ status: 'skipped' });
    });

    it('a caller holding the lock with the gate already read (root + live handle) is not gated again; a handle no longer live falls back to the gate', async () => {
      const tip = await shadowWith({ 'pages/c.md': '# c\n' });
      const gate = vi.spyOn(svc, 'mergePrimitiveRoot');
      try {
        const results = await svc.tryWithRepoLock(async (lock) => {
          const held = { root: root(), lock };
          const pending = await svc.pendingChanges([pages()], held);
          const merged = await svc.mergeIntoIndex(tip, abs('pages/c.md'), held);
          const aborted = await svc.abortMerge(abs('pages/c.md'), held);
          return { pending, merged, aborted };
        });
        expect(results).toEqual({
          pending: { status: 'clean' },
          merged: { status: 'merged', changedPaths: abs('pages/c.md') },
          aborted: { status: 'aborted' },
        });
        // No config read, no `rev-parse` of the root and the branch per primitive.
        expect(gate).not.toHaveBeenCalled();

        let stale!: GitLockHandle;
        await svc.tryWithRepoLock(async (lock) => {
          stale = lock;
        });
        await git(['checkout', '-q', '--detach'], dir);
        expect(await svc.pendingChanges([pages()], { root: root(), lock: stale })).toEqual({ status: 'no-branch' });
        expect(gate).toHaveBeenCalledTimes(1);
      } finally {
        gate.mockRestore();
      }
    });
  });

  describe('[section:es9w55mr] mergeIntoIndex(tipSha, changedPaths)', () => {
    it('merges into the index and working tree without a commit, MERGE_HEAD open; merged answers the base→tip paths the caller read before the merge (absolute, a move as delete + add)', async () => {
      const tip = await shadowWith({ 'pages/a.md': '# a\n\nline 1\nfrom shadow\n', 'pages/c.md': '# c\n' });
      // A move on the shadow too: b.md → moved/b.md.
      await git(['checkout', '-q', '-b', 'mv', tip], dir);
      fs.mkdirSync(path.join(pages(), 'moved'), { recursive: true });
      await git(['mv', 'pages/b.md', 'pages/moved/b.md'], dir);
      await git(['commit', '-q', '-m', 'move'], dir);
      const movedTip = await sha('HEAD');
      await git(['checkout', '-q', 'main'], dir);
      fs.writeFileSync(path.join(dir, 'outside.txt'), 'outside 2\n');
      await git(['commit', '-q', '-am', 'master moved ahead'], dir);
      const headBefore = await sha('HEAD');
      // The caller's read before the merge: `merge-base..tip`, no rename detection.
      const base = (await git(['merge-base', 'HEAD', movedTip], dir)).trim();
      const known = await svc.shadowChangedPaths(base, movedTip, { detected: true, rootPath: root() });
      expect([...(known ?? [])].sort()).toEqual(abs('pages/a.md', 'pages/b.md', 'pages/c.md', 'pages/moved/b.md').sort());

      const result = await svc.mergeIntoIndex(movedTip, known!);
      expect(result).toEqual({ status: 'merged', changedPaths: known });
      expect(await sha('HEAD')).toBe(headBefore); // no commit
      expect(await mergeHead()).toBe(movedTip);
      expect(fs.readFileSync(path.join(pages(), 'a.md'), 'utf8')).toContain('from shadow');
      expect((await git(['diff', '--cached', '--name-only'], dir)).split('\n')).toContain('pages/c.md');
    });

    it('a real conflict: the merge is aborted here and conflicts lists the paths — HEAD, index, working tree as before', async () => {
      const tip = await shadowWith({ 'pages/a.md': '# a\n\nline 1 — shadow\n' });
      fs.writeFileSync(path.join(pages(), 'a.md'), '# a\n\nline 1 — master\n');
      await git(['commit', '-q', '-am', 'master edit'], dir);
      const headBefore = await sha('HEAD');

      expect(await svc.mergeIntoIndex(tip, abs('pages/a.md'))).toEqual({ status: 'conflicts', paths: ['pages/a.md'] });
      expect(await mergeHead()).toBeNull();
      expect(await sha('HEAD')).toBe(headBefore);
      expect((await git(['status', '--porcelain'], dir)).trim()).toBe('');
      expect(fs.readFileSync(path.join(pages(), 'a.md'), 'utf8')).toBe('# a\n\nline 1 — master\n');
    });

    it('a conflict whose own merge --abort fails → error with the repair context merge-abort-failed (operation commit-on-release); the merge stays open', async () => {
      const tip = await shadowWith({ 'pages/a.md': '# a\n\nline 1 — shadow\n' });
      fs.writeFileSync(path.join(pages(), 'a.md'), '# a\n\nline 1 — master\n');
      await git(['commit', '-q', '-am', 'master edit'], dir);
      const indexLock = path.join(dir, '.git', 'index.lock');
      // Stubbed step: right before the internal `merge --abort`, another process takes the index lock.
      type GitRunner = { git: (args: string[], cwd: string, ...rest: unknown[]) => Promise<{ stdout: string; stderr: string }> };
      const runner = svc as unknown as GitRunner;
      const original = runner.git.bind(svc);
      const spy = vi.spyOn(runner, 'git').mockImplementation(async (args, cwd, ...rest) => {
        if (args[0] === 'merge' && args[1] === '--abort') fs.writeFileSync(indexLock, '');
        return original(args, cwd, ...rest);
      });
      try {
        const result = await svc.mergeIntoIndex(tip, abs('pages/a.md'));
        expect(result.status).toBe('error');
        if (result.status !== 'error') return;
        expect(result.recovery?.kind).toBe('merge-abort-failed');
        expect(result.recovery?.operation).toBe('commit-on-release');
        expect(result.recovery?.gitStderr).toContain('index.lock');
        expect(result.recovery?.intentPrompt).toContain('git merge --abort');
        expect(await mergeHead()).toBe(tip);
      } finally {
        spy.mockRestore();
        fs.rmSync(indexLock, { force: true });
      }
      // Lock released on the failure path: the next call goes through and undoes the open merge.
      expect(await svc.abortMerge([path.join(pages(), 'a.md')])).toEqual({ status: 'aborted' });
      expect(await mergeHead()).toBeNull();
    });

    it('a tip already contained in HEAD leaves no merge open → error; lock taken without the handle → busy', async () => {
      const head = await sha('HEAD');
      const contained = await svc.mergeIntoIndex(head, []);
      expect(contained.status).toBe('error');
      expect(await mergeHead()).toBeNull();

      const tip = await shadowWith({ 'pages/c.md': '# c\n' });
      const busy = await svc.tryWithRepoLock(async () => svc.mergeIntoIndex(tip, abs('pages/c.md')));
      expect(busy).toEqual({ status: 'busy' });
      expect(await mergeHead()).toBeNull();
    });
  });

  describe('[section:es9w55mr] abortMerge(paths)', () => {
    it('stages the paths first (changes written after the merge would block merge --abort), then aborts — the repository is back where it was', async () => {
      const tip = await shadowWith({ 'pages/a.md': '# a\n\nline 1\nfrom shadow\n' });
      const headBefore = await sha('HEAD');
      expect((await svc.mergeIntoIndex(tip, abs('pages/a.md'))).status).toBe('merged');
      // An anchor written into the merged page after the merge, not staged.
      fs.writeFileSync(path.join(pages(), 'a.md'), '# a\n\nline 1\nfrom shadow\n<!-- anchor -->\n');
      // Without staging first, git refuses to abort.
      await expect(pexec('git', ['merge', '--abort'], { cwd: dir })).rejects.toBeTruthy();
      expect(await mergeHead()).toBe(tip);

      expect(await svc.abortMerge([path.join(pages(), 'a.md')])).toEqual({ status: 'aborted' });
      expect(await mergeHead()).toBeNull();
      expect(await sha('HEAD')).toBe(headBefore);
      expect((await git(['status', '--porcelain'], dir)).trim()).toBe('');
      expect(fs.readFileSync(path.join(pages(), 'a.md'), 'utf8')).toBe('# a\n\nline 1\n');
    });

    it('a failed abort → error with the repair context merge-abort-failed (operation commit-on-release); the merge stays open', async () => {
      const tip = await shadowWith({ 'pages/c.md': '# c\n' });
      expect((await svc.mergeIntoIndex(tip, abs('pages/c.md'))).status).toBe('merged');
      // Inject the failure: another process holds the index lock.
      const indexLock = path.join(dir, '.git', 'index.lock');
      fs.writeFileSync(indexLock, '');
      try {
        const result = await svc.abortMerge([path.join(pages(), 'c.md')]);
        expect(result.status).toBe('error');
        if (result.status !== 'error') return;
        expect(result.recovery.kind).toBe('merge-abort-failed');
        expect(result.recovery.operation).toBe('commit-on-release');
        expect(result.recovery.gitStderr).toContain('index.lock');
        expect(result.recovery.intentPrompt).toContain('git merge --abort');
        expect(await mergeHead()).toBe(tip);
      } finally {
        fs.rmSync(indexLock, { force: true });
      }
      // Lock released on the failure path: the next call goes through.
      expect(await svc.abortMerge([path.join(pages(), 'c.md')])).toEqual({ status: 'aborted' });
    });

    it('no merge open → aborted, nothing touched', async () => {
      fs.writeFileSync(path.join(pages(), 'a.md'), '# a — unsaved\n');
      expect(await svc.abortMerge([path.join(pages(), 'a.md')])).toEqual({ status: 'aborted' });
      expect(fs.readFileSync(path.join(pages(), 'a.md'), 'utf8')).toBe('# a — unsaved\n');
      expect((await git(['diff', '--cached', '--name-only'], dir)).trim()).toBe('');
    });
  });

  describe('[section:aqys9dje] the release commit with MERGE_HEAD open', () => {
    it.each([
      ['current', { mode: 'current' }],
      ['named', { mode: 'named', branch: 'release-target' }],
      ['new', { mode: 'new', template: 'release/{release_slug}', base: 'main' }],
    ])(
      '[section:eu1rffp6] [section:m17reldiff] mode %s: a merge commit with two parents (HEAD + the shadow tip) on the current branch, branch = current, switched false; the release file entering only in the merge commit makes it the marker',
      async (_mode, commitTarget) => {
        const tip = await shadowWith({ 'pages/c.md': '# c\n' });
        await git(['branch', 'release-target'], dir);
        writeConfigJson(dir, { enabled: true, commitTarget, switchAfterRelease: true });
        const headBefore = await sha('HEAD');
        const targetBefore = await sha('release-target');
        expect((await svc.mergeIntoIndex(tip, abs('pages/c.md'))).status).toBe('merged');
        const releaseFile = path.join(dir, '.claude4spec', 'releases', 'v1.json');
        fs.mkdirSync(path.dirname(releaseFile), { recursive: true });
        fs.writeFileSync(releaseFile, '{"name":"v1"}\n');

        const result = await svc.commitOnRelease({ name: 'v1', description: 'accepts run-1' });
        expect(result).toEqual({ status: 'committed', branch: 'main', switched: false });
        const parents = (await git(['rev-list', '--parents', '-n', '1', 'HEAD'], dir)).trim().split(' ').slice(1);
        expect(parents).toEqual([headBefore, tip]);
        expect((await git(['log', '-1', '--format=%B'], dir)).trim()).toBe('v1\n\naccepts run-1');
        expect(await mergeHead()).toBeNull();
        expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim()).toBe('main');
        // No temp-index commit elsewhere, no new branch.
        expect(await sha('release-target')).toBe(targetBefore);
        expect((await git(['branch', '--list', 'release/*'], dir)).trim()).toBe('');
        // [section:eu1rffp6] the release file enters only in the merge commit — counted against
        // the first parent, that commit is the marker.
        expect(await svc.resolveReleaseCommit(releaseFile)).toBe(await sha('HEAD'));
        // [section:m17reldiff] the reign boundary `M_next~1` of this marker (release.ts `resolveReignRef`)
        // is its first parent — master before the acceptance.
        expect(await sha(`${await sha('HEAD')}~1`)).toBe(headBefore);
      },
    );

    it('[section:ezudoqef] called with the live lock handle the commit runs under the held lock instead of waiting (no hang); without it, it waits for the release', async () => {
      const tip = await shadowWith({ 'pages/c.md': '# c\n' });
      const headBefore = await sha('HEAD');
      const result = await svc.tryWithRepoLock(async (lock) => {
        const merged = await svc.mergeIntoIndex(tip, abs('pages/c.md'), { root: root(), lock });
        expect(merged.status).toBe('merged');
        fs.mkdirSync(path.join(dir, '.claude4spec', 'releases'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude4spec', 'releases', 'v1.json'), '{"name":"v1"}\n');
        // A sidebar operation meanwhile answers busy.
        expect((await svc.checkout('main')).status).toBe('busy');
        return svc.commitOnRelease({ name: 'v1', description: 'd' }, lock);
      });
      expect(result?.status).toBe('committed');
      expect((await git(['rev-list', '--parents', '-n', '1', 'HEAD'], dir)).trim().split(' ').slice(1)).toEqual([
        headBefore,
        tip,
      ]);
      // The lock was released: a second take succeeds.
      expect(await svc.tryWithRepoLock(async () => 'free')).toBe('free');

      // A stale handle (its holder finished) opens nothing: the commit waits for the current holder.
      let stale!: GitLockHandle;
      await svc.tryWithRepoLock(async (lock) => {
        stale = lock;
      });
      const order: string[] = [];
      let releaseHolder!: () => void;
      let tookLock!: () => void;
      const lockTaken = new Promise<void>((resolve) => (tookLock = resolve));
      const holder = svc.tryWithRepoLock(
        () =>
          new Promise<void>((resolve) => {
            releaseHolder = () => {
              order.push('holder');
              resolve();
            };
            tookLock();
          }),
      );
      await lockTaken;
      fs.writeFileSync(path.join(pages(), 'd.md'), '# d\n');
      const commit = svc.commitOnRelease({ name: 'v2', description: 'd' }, stale).then((r) => {
        order.push('commit');
        return r;
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(order).toEqual([]);
      releaseHolder();
      await holder;
      expect((await commit)?.status).toBe('committed');
      expect(order).toEqual(['holder', 'commit']);
    });

    it('a failed merge commit → error with recovery.kind merge-open; the merge stays open', async () => {
      const tip = await shadowWith({ 'pages/c.md': '# c\n' });
      const hooks = path.join(dir, '.test-hooks');
      fs.mkdirSync(hooks);
      fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho "pre-commit refused" >&2\nexit 1\n', {
        mode: 0o755,
      });
      await git(['config', 'core.hooksPath', hooks], dir);
      expect((await svc.mergeIntoIndex(tip, abs('pages/c.md'))).status).toBe('merged');

      const result = await svc.commitOnRelease({ name: 'v1', description: 'd' });
      expect(result?.status).toBe('error');
      expect(result?.recovery?.kind).toBe('merge-open');
      expect(result?.recovery?.operation).toBe('commit-on-release');
      expect(result?.recovery?.gitStderr).toContain('pre-commit refused');
      expect(await mergeHead()).toBe(tip);
    });
  });
});

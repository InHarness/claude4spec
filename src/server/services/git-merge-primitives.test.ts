import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitRepoLock, GitService, type GitHeldRepo, type GitLockHandle } from './git.js';
import type {
  GitAbortMergeResult,
  GitAheadBehindStatus,
  GitCommitResult,
  GitMergeIntoIndexResult,
  GitPendingChangesResult,
  GitRefDiff,
} from '../../shared/git.js';

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

    it('2.1.52: a single-path pathspec collides with an equal pending path, its ancestor and its descendant — by path segments, never by string prefix', async () => {
      const plans = path.join(dir, 'plans');
      fs.mkdirSync(path.join(plans, 'd'), { recursive: true });
      fs.writeFileSync(path.join(plans, 'x'), 'a file where the shadow puts a directory\n'); // ancestor of plans/x/a.md
      fs.writeFileSync(path.join(plans, 'xy.md'), 'a string prefix only\n');
      fs.writeFileSync(path.join(plans, 'd', 'inner.md'), 'inner\n'); // descendant of plans/d
      fs.writeFileSync(path.join(plans, 'same.md'), 'same\n'); // equal
      fs.writeFileSync(path.join(plans, 'other.md'), 'other\n'); // no collision
      expect(await svc.pendingChanges(abs('plans/x/a.md', 'plans/d', 'plans/same.md'))).toEqual({
        status: 'dirty',
        paths: ['plans/d/inner.md', 'plans/same.md', 'plans/x'],
      });
      expect(await svc.pendingChanges(abs('plans/x'))).toEqual({ status: 'dirty', paths: ['plans/x'] });
      expect(await svc.pendingChanges(abs('plans/zzz.md'))).toEqual({ status: 'clean' });
      // Root dirs and single paths mix freely; staged-anywhere still joins the result.
      fs.writeFileSync(path.join(pages(), 'a.md'), '# a edited\n');
      fs.writeFileSync(path.join(dir, 'outside.txt'), 'outside staged\n');
      await git(['add', 'outside.txt'], dir);
      expect(await svc.pendingChanges([pages(), ...abs('plans/same.md')])).toEqual({
        status: 'dirty',
        paths: ['outside.txt', 'pages/a.md', 'plans/same.md'],
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
        expect(result.recovery?.intentPrompt).toContain('the files the shadow modified:\n  - pages/a.md');
        expect(await mergeHead()).toBe(tip);
      } finally {
        spy.mockRestore();
        fs.rmSync(indexLock, { force: true });
      }
      // Lock released on the failure path: the next call goes through and undoes the open merge.
      expect(await svc.abortMerge([path.join(pages(), 'a.md')])).toEqual({ status: 'aborted' });
      expect(await mergeHead()).toBeNull();
    });

    it.each([
      ['a modified tracked file', 'pages/a.md'],
      ['an untracked file', 'pages/c.md'],
    ])('2.1.52: git refusing to start the merge over %s it would overwrite → dirty with the paths of its refusal; the repository is untouched', async (_label, rel) => {
      const tip = await shadowWith({ 'pages/a.md': '# a\n\nline 1 — shadow\n', 'pages/c.md': '# c — shadow\n' });
      fs.writeFileSync(path.join(dir, rel), '# mine, not saved anywhere\n');
      const headBefore = await sha('HEAD');
      const statusBefore = await git(['status', '--porcelain', '--untracked-files=all'], dir);
      expect(await svc.mergeIntoIndex(tip, abs('pages/a.md', 'pages/c.md'))).toEqual({ status: 'dirty', paths: [rel] });
      expect(await mergeHead()).toBeNull();
      expect(await sha('HEAD')).toBe(headBefore);
      expect(await git(['status', '--porcelain', '--untracked-files=all'], dir)).toBe(statusBefore);
      expect(fs.readFileSync(path.join(dir, rel), 'utf8')).toBe('# mine, not saved anywhere\n');
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

    it('a path the shadow deleted (in neither the merged index nor the working tree) is staged without error and the abort brings it back, together with a path the shadow added', async () => {
      await git(['checkout', '-q', '-b', 'shadow-src', 'main'], dir);
      await git(['rm', '-q', 'pages/a.md'], dir);
      fs.writeFileSync(path.join(pages(), 'c.md'), '# c\n');
      await git(['add', 'pages/c.md'], dir);
      await git(['commit', '-q', '-m', 'shadow turn'], dir);
      const tip = await sha('HEAD');
      await git(['checkout', '-q', 'main'], dir);
      await git(['branch', '-q', '-D', 'shadow-src'], dir);
      const headBefore = await sha('HEAD');
      const changed = abs('pages/a.md', 'pages/c.md');
      expect((await svc.mergeIntoIndex(tip, changed)).status).toBe('merged');
      expect(fs.existsSync(path.join(pages(), 'a.md'))).toBe(false);

      expect(await svc.abortMerge(changed)).toEqual({ status: 'aborted' });
      expect(await mergeHead()).toBeNull();
      expect(await sha('HEAD')).toBe(headBefore);
      expect((await git(['status', '--porcelain', '--untracked-files=all'], dir)).trim()).toBe('');
      expect(fs.readFileSync(path.join(pages(), 'a.md'), 'utf8')).toBe('# a\n\nline 1\n');
      expect(fs.existsSync(path.join(pages(), 'c.md'))).toBe(false);
    });

    it('a shadow turning a file into a directory (and a directory into a file) — the directory on disk is not staged as a path, its files are, and the abort restores both', async () => {
      // Master gains a directory the shadow will turn into a file.
      fs.mkdirSync(path.join(pages(), 'sub'), { recursive: true });
      fs.writeFileSync(path.join(pages(), 'sub', 'd.md'), '# d\n');
      await git(['add', 'pages/sub/d.md'], dir);
      await git(['commit', '-q', '-m', 'sub dir'], dir);

      await git(['checkout', '-q', '-b', 'shadow-src', 'main'], dir);
      // file → directory: pages/b.md becomes pages/b.md/inner.md
      await git(['rm', '-q', 'pages/b.md'], dir);
      fs.mkdirSync(path.join(pages(), 'b.md'));
      fs.writeFileSync(path.join(pages(), 'b.md', 'inner.md'), '# inner\n');
      // directory → file: pages/sub/d.md goes, pages/sub becomes a file
      await git(['rm', '-q', 'pages/sub/d.md'], dir);
      fs.writeFileSync(path.join(pages(), 'sub'), 'now a file\n');
      await git(['add', 'pages/b.md/inner.md', 'pages/sub'], dir);
      await git(['commit', '-q', '-m', 'shadow turn'], dir);
      const tip = await sha('HEAD');
      await git(['checkout', '-q', 'main'], dir);
      await git(['branch', '-q', '-D', 'shadow-src'], dir);
      const headBefore = await sha('HEAD');

      // What `git diff merge-base..tip` lists: both sides of each swap.
      const changed = abs('pages/b.md', 'pages/b.md/inner.md', 'pages/sub', 'pages/sub/d.md');
      expect((await svc.mergeIntoIndex(tip, changed)).status).toBe('merged');
      expect(fs.statSync(path.join(pages(), 'b.md')).isDirectory()).toBe(true);
      expect(fs.statSync(path.join(pages(), 'sub')).isFile()).toBe(true);
      // Changes written after the merge, not staged, on both sides of the swaps.
      fs.writeFileSync(path.join(pages(), 'b.md', 'inner.md'), '# inner\n<!-- anchor -->\n');
      fs.writeFileSync(path.join(pages(), 'sub'), 'now a file\n<!-- anchor -->\n');
      // Staging the directory itself is what git refuses.
      await expect(
        pexec('git', ['update-index', '--add', '--remove', '--', 'pages/b.md'], { cwd: dir }),
      ).rejects.toBeTruthy();

      expect(await svc.abortMerge(changed)).toEqual({ status: 'aborted' });
      expect(await mergeHead()).toBeNull();
      expect(await sha('HEAD')).toBe(headBefore);
      expect((await git(['status', '--porcelain', '--untracked-files=all'], dir)).trim()).toBe('');
      expect(fs.readFileSync(path.join(pages(), 'b.md'), 'utf8')).toBe('# b\n');
      expect(fs.readFileSync(path.join(pages(), 'sub', 'd.md'), 'utf8')).toBe('# d\n');
    });

    it('[section:u5vl07ch] a failed abort → error with the repair context merge-abort-failed (operation commit-on-release); the merge stays open', async () => {
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
        expect(result.recovery.intentPrompt).toContain('Delete the files the shadow added:\n  - pages/c.md');
        expect(await mergeHead()).toBe(tip);
      } finally {
        fs.rmSync(indexLock, { force: true });
      }
      // Lock released on the failure path: the next call goes through.
      expect(await svc.abortMerge([path.join(pages(), 'c.md')])).toEqual({ status: 'aborted' });
    });

    it('2.1.52: files outside `paths` survive the abort — an unstaged change stays unstaged with its content, an untracked file stays untracked', async () => {
      const tip = await shadowWith({ 'pages/c.md': '# c\n' });
      fs.writeFileSync(path.join(pages(), 'b.md'), '# b — unsaved\n');
      fs.writeFileSync(path.join(pages(), 'draft.md'), '# draft\n');
      expect((await svc.mergeIntoIndex(tip, abs('pages/c.md'))).status).toBe('merged');
      expect(await svc.abortMerge(abs('pages/c.md'))).toEqual({ status: 'aborted' });
      expect(await mergeHead()).toBeNull();
      const status = (await git(['status', '--porcelain', '--untracked-files=all'], dir)).split('\n').filter(Boolean).sort();
      expect(status).toEqual([' M pages/b.md', '?? pages/draft.md']);
      expect(fs.readFileSync(path.join(pages(), 'b.md'), 'utf8')).toBe('# b — unsaved\n');
      expect(fs.readFileSync(path.join(pages(), 'draft.md'), 'utf8')).toBe('# draft\n');
      expect(fs.existsSync(path.join(pages(), 'c.md'))).toBe(false);
    });

    it('2.1.52: the merge-abort-failed prompt names the shadow paths by what the shadow did — added, modified, deleted — and no other pending file', async () => {
      await git(['checkout', '-q', '-b', 'shadow-src', 'main'], dir);
      fs.writeFileSync(path.join(pages(), 'a.md'), '# a\n\nline 1 — shadow\n');
      await git(['rm', '-q', 'pages/b.md'], dir);
      fs.writeFileSync(path.join(pages(), 'c.md'), '# c\n');
      await git(['add', '-A'], dir);
      await git(['commit', '-q', '-m', 'shadow turn'], dir);
      const tip = await sha('HEAD');
      await git(['checkout', '-q', 'main'], dir);
      await git(['branch', '-q', '-D', 'shadow-src'], dir);
      fs.writeFileSync(path.join(dir, 'outside.txt'), 'outside — unsaved\n');
      fs.writeFileSync(path.join(pages(), 'draft.md'), '# draft\n');
      const changed = abs('pages/a.md', 'pages/b.md', 'pages/c.md');
      expect((await svc.mergeIntoIndex(tip, changed)).status).toBe('merged');
      const indexLock = path.join(dir, '.git', 'index.lock');
      fs.writeFileSync(indexLock, '');
      try {
        const result = await svc.abortMerge(changed);
        expect(result.status).toBe('error');
        if (result.status !== 'error') return;
        const prompt = result.recovery.intentPrompt;
        expect(prompt).toContain('Delete the files the shadow added:\n  - pages/c.md');
        expect(prompt).toContain('Restore to their state in HEAD the files the shadow modified:\n  - pages/a.md');
        expect(prompt).toContain('Restore to their state in HEAD the files the shadow deleted:\n  - pages/b.md');
        expect(prompt).toContain('Leave every other change of the working tree untouched. Do not commit.');
        expect(prompt).not.toContain('draft.md');
        expect(prompt).not.toContain('outside.txt');
      } finally {
        fs.rmSync(indexLock, { force: true });
      }
      expect(await svc.abortMerge(changed)).toEqual({ status: 'aborted' });
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

  /**
   * 2.1.49 (code-snippet git-service-contract): the GitService API the snippet
   * states — a compile-time shape check (typecheck fails on a drifted
   * signature) plus the behaviour each line of the snippet promises.
   */
  describe('[entity:git-service-contract] GitService — repo lock, merge primitives, ref diff, status, release marker', () => {
    interface GitServiceContract {
      commitOnRelease(
        release: { name: string; description: string },
        lockHandle?: GitLockHandle,
      ): Promise<GitCommitResult | null>;
      commit(opts: { name: string; description: string }, lockHandle?: GitLockHandle): Promise<GitCommitResult>;
      resolveReleaseCommit(path: string): Promise<string | null>;
      diffRefs(shaA: string, shaB: string, pathspecs: string[]): Promise<GitRefDiff | null>;
      statusAheadBehind(): Promise<GitAheadBehindStatus | null>;
      tryWithRepoLock<T>(fn: (lock: GitLockHandle) => Promise<T>): Promise<T | null>;
      pendingChanges(pathspecs: string[], held?: GitHeldRepo): Promise<GitPendingChangesResult>;
      mergeIntoIndex(tipSha: string, changedPaths: string[], held?: GitHeldRepo): Promise<GitMergeIntoIndexResult>;
      abortMerge(paths: string[], held?: GitHeldRepo): Promise<GitAbortMergeResult>;
    }

    /** Commit everything staged with author and committer date `iso`. */
    async function commitAt(message: string, iso: string): Promise<string> {
      await pexec('git', ['commit', '-q', '-m', message], {
        cwd: dir,
        env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
      });
      return sha('HEAD');
    }

    it('[section:ezudoqef] the scoped lock: tryWithRepoLock runs fn with a handle and releases it after; taken → null without calling fn; commit and commitOnRelease take the bare handle and run under the held lock', async () => {
      const contract: GitServiceContract = svc;
      for (const name of [
        'commitOnRelease',
        'commit',
        'resolveReleaseCommit',
        'diffRefs',
        'statusAheadBehind',
        'tryWithRepoLock',
        'pendingChanges',
        'mergeIntoIndex',
        'abortMerge',
      ] as const) {
        expect(typeof contract[name]).toBe('function');
      }

      const inner = vi.fn(async () => 'never');
      const outcome = await svc.tryWithRepoLock(async (lock) => {
        // Taken: a second scoped take answers null and never calls its fn.
        const second = await svc.tryWithRepoLock(inner);
        fs.writeFileSync(path.join(pages(), 'c.md'), '# c\n');
        const viaCommit = await svc.commit({ name: 'v1', description: 'first' }, lock);
        fs.writeFileSync(path.join(pages(), 'd.md'), '# d\n');
        const viaEntry = await svc.commitOnRelease({ name: 'v2', description: 'second' }, lock);
        return { second, viaCommit: viaCommit.status, viaEntry: viaEntry?.status };
      });
      expect(outcome).toEqual({ second: null, viaCommit: 'committed', viaEntry: 'committed' });
      expect(inner).not.toHaveBeenCalled();
      expect((await git(['log', '-2', '--format=%s'], dir)).trim().split('\n')).toEqual(['v2', 'v1']);
      // Released when the scoped call ended: the next take runs.
      expect(await svc.tryWithRepoLock(async () => 'free')).toBe('free');
    });

    it('[section:es9w55mr] the merge primitives never throw: a failed read → pendingChanges error { message }; merged answers the caller\'s changedPaths as given, without recomputing; abortMerge with no merge open → aborted', async () => {
      const tip = await shadowWith({ 'pages/c.md': '# c\n' });
      // The caller's set comes back verbatim — even one the primitive would not derive itself.
      const given = abs('pages/c.md', 'pages/given-by-caller.md');
      const merged = await svc.mergeIntoIndex(tip, given);
      expect(merged).toEqual({ status: 'merged', changedPaths: given });
      expect(await svc.abortMerge(abs('pages/c.md'))).toEqual({ status: 'aborted' });
      expect(await mergeHead()).toBeNull();
      // Nothing open any more: still aborted, nothing to undo.
      expect(await svc.abortMerge(abs('pages/c.md'))).toEqual({ status: 'aborted' });

      // An unreadable index: `git status` fails → error, not a throw.
      fs.writeFileSync(path.join(dir, '.git', 'index'), 'this is not a git index file at all');
      const pending = await svc.pendingChanges([pages()]);
      expect(pending.status).toBe('error');
      expect(pending.status === 'error' && pending.message.length > 0).toBe(true);
    });

    it('[section:m28aug01] diffRefs takes a tree SHA on the right (two arguments, not a range) and returns the files with status A/M/D; statusAheadBehind is null only without a repo or with the master switch off', async () => {
      const before = await sha('HEAD');
      fs.writeFileSync(path.join(pages(), 'a.md'), '# a\n\nline 2\n');
      fs.rmSync(path.join(pages(), 'b.md'));
      fs.writeFileSync(path.join(pages(), 'n.md'), '# n\n');
      await git(['add', '-A'], dir);
      const tree = (await git(['write-tree'], dir)).trim();
      expect((await git(['cat-file', '-t', tree], dir)).trim()).toBe('tree');

      const diff = await svc.diffRefs(before, tree, [pages()]);
      expect(diff).not.toBeNull();
      const byPath = Object.fromEntries(diff!.files.map((f) => [path.relative(root(), f.path), f.status]));
      expect(byPath).toEqual({ 'pages/a.md': 'M', 'pages/b.md': 'D', 'pages/n.md': 'A' });
      // A failing git call never throws: an unknown revision → null.
      expect(await svc.diffRefs('0000000000000000000000000000000000000000', tree, [pages()])).toBeNull();

      expect(await svc.statusAheadBehind()).toEqual({ branch: 'main', isDirty: true, ahead: null, behind: null });
      writeConfigJson(dir, { enabled: false });
      expect(await svc.statusAheadBehind()).toBeNull();

      const noRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-norepo-'));
      try {
        writeConfigJson(noRepo, { enabled: true });
        fs.mkdirSync(path.join(noRepo, 'pages'));
        expect(await new GitService(noRepo, [path.join(noRepo, 'pages')]).statusAheadBehind()).toBeNull();
      } finally {
        fs.rmSync(noRepo, { recursive: true, force: true });
      }
    });

    it('[section:57bep23m] resolveReleaseCommit forces topological order: the ancestor introduction wins over a descendant re-introduction dated earlier', async () => {
      const marker = path.join(pages(), 'releases', 'v1.json');
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      // X — the real marker, introduces the file (late date).
      fs.writeFileSync(marker, '{"name":"v1"}\n');
      await git(['add', '-A'], dir);
      const x = await commitAt('X adds v1.json', '2025-06-01T00:00:00Z');

      // Side line off X: Z deletes the file, Y re-introduces it — both dated BEFORE X.
      await git(['checkout', '-q', '-b', 'side', x], dir);
      fs.rmSync(marker);
      await git(['add', '-A'], dir);
      await commitAt('Z deletes', '2001-01-01T00:00:00Z');
      fs.writeFileSync(marker, '{"name":"v1","side":true}\n');
      await git(['add', '-A'], dir);
      const y = await commitAt('Y re-adds', '2000-01-01T00:00:00Z');
      fs.writeFileSync(path.join(pages(), 'side.md'), '# side\n');
      await git(['add', '-A'], dir);
      await commitAt('P2', '2030-01-01T00:00:00Z');

      // Main line: P1 after X, then a merge of the side line whose file differs from both parents.
      await git(['checkout', '-q', 'main'], dir);
      fs.writeFileSync(path.join(pages(), 'main.md'), '# main\n');
      await git(['add', '-A'], dir);
      await commitAt('P1', '2020-01-01T00:00:00Z');
      await git(['merge', '-q', '--no-ff', '--no-commit', 'side'], dir);
      fs.writeFileSync(marker, '{"name":"v1","merged":true}\n');
      await git(['add', '-A'], dir);
      await commitAt('merge side', '2040-01-01T00:00:00Z');

      // Both X and Y introduce the path in HEAD's history; Y is X's descendant yet dated earlier.
      const adds = (await git(['log', '--diff-filter=A', '--format=%H', '--', marker], dir)).trim().split('\n');
      expect(adds).toEqual(expect.arrayContaining([x, y]));
      expect(await svc.resolveReleaseCommit(marker)).toBe(x);
    });
  });
});

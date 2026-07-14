import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitService } from './git.js';

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

function writeConfigJson(cwd: string, git: Record<string, unknown>): void {
  const dir = path.join(cwd, '.claude4spec');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ $schemaVersion: 4, name: 'test', git }, null, 2),
  );
}

describe('GitService — 0.1.118 read-only methods', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-svc-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('gated on config.git.enabled', () => {
    it('resolveReleaseCommit/diffRefs/statusAheadBehind all return null when git.enabled is false', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: false });
      const svc = new GitService(dir, [dir]);

      expect(await svc.resolveReleaseCommit(path.join(dir, 'foo.json'))).toBeNull();
      expect(await svc.diffRefs('HEAD~1', 'HEAD', [dir])).toBeNull();
      expect(await svc.statusAheadBehind()).toBeNull();
      expect(await svc.showFile('HEAD', path.join(dir, 'foo.md'))).toBeNull();
    });

    it('all three return null (not throw) when git.enabled is true but no repo exists', async () => {
      fs.mkdirSync(dir, { recursive: true });
      writeConfigJson(dir, { enabled: true });
      const svc = new GitService(dir, [dir]);

      expect(await svc.resolveReleaseCommit(path.join(dir, 'foo.json'))).toBeNull();
      expect(await svc.diffRefs('HEAD~1', 'HEAD', [dir])).toBeNull();
      expect(await svc.statusAheadBehind()).toBeNull();
      expect(await svc.showFile('HEAD', path.join(dir, 'foo.md'))).toBeNull();
    });
  });

  describe('with a real repo, git.enabled = true', () => {
    beforeEach(async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
    });

    it('resolveReleaseCommit returns the SHA that first added the file, null for an uncommitted file', async () => {
      const svc = new GitService(dir, [dir]);
      const releasesDir = path.join(dir, 'releases');
      fs.mkdirSync(releasesDir, { recursive: true });
      const filePath = path.join(releasesDir, 'v1.json');
      fs.writeFileSync(filePath, '{}');

      // Not committed yet.
      expect(await svc.resolveReleaseCommit(filePath)).toBeNull();

      await git(['add', '.'], dir);
      await git(['commit', '-m', 'add v1'], dir);
      const sha = await svc.resolveReleaseCommit(filePath);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);

      const headSha = (await git(['rev-parse', 'HEAD'], dir)).trim();
      expect(sha).toBe(headSha);
    });

    it('resolveReleaseCommit returns null for a path outside the repo', async () => {
      const svc = new GitService(dir, [dir]);
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-outside-'));
      const outsideFile = path.join(outside, 'x.json');
      fs.writeFileSync(outsideFile, '{}');
      try {
        expect(await svc.resolveReleaseCommit(outsideFile)).toBeNull();
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('diffRefs reports A/M across two commits scoped to given paths', async () => {
      const svc = new GitService(dir, [dir]);
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v1');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'first'], dir);
      const shaA = (await git(['rev-parse', 'HEAD'], dir)).trim();

      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v2');
      fs.writeFileSync(path.join(pagesDir, 'b.md'), '# B v1');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'second'], dir);
      const shaB = (await git(['rev-parse', 'HEAD'], dir)).trim();

      const diff = await svc.diffRefs(shaA, shaB, [pagesDir]);
      expect(diff).not.toBeNull();
      const byPath = new Map(diff!.files.map((f) => [path.basename(f.path), f.status]));
      expect(byPath.get('a.md')).toBe('M');
      expect(byPath.get('b.md')).toBe('A');
    });

    it('diffRefs flattens a rename into delete(old) + create(new)', async () => {
      const svc = new GitService(dir, [dir]);
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      // Content long/distinctive enough for git's rename heuristic to detect it.
      const body = '# Renamed page\n' + 'lorem ipsum '.repeat(50);
      fs.writeFileSync(path.join(pagesDir, 'old-name.md'), body);
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'first'], dir);
      const shaA = (await git(['rev-parse', 'HEAD'], dir)).trim();

      fs.renameSync(path.join(pagesDir, 'old-name.md'), path.join(pagesDir, 'new-name.md'));
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'rename'], dir);
      const shaB = (await git(['rev-parse', 'HEAD'], dir)).trim();

      const diff = await svc.diffRefs(shaA, shaB, [pagesDir]);
      expect(diff).not.toBeNull();
      const byName = new Map(diff!.files.map((f) => [path.basename(f.path), f.status]));
      expect(byName.get('old-name.md')).toBe('D');
      expect(byName.get('new-name.md')).toBe('A');
    });

    it('diffRefs surfaces a "T" type-change (file → symlink) as modified rather than dropping it', async () => {
      const svc = new GitService(dir, [dir]);
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      const target = path.join(pagesDir, 'a.md');
      fs.writeFileSync(target, '# A');
      fs.writeFileSync(path.join(pagesDir, 'b.md'), '# B');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'first'], dir);
      const shaA = (await git(['rev-parse', 'HEAD'], dir)).trim();

      fs.rmSync(target);
      fs.symlinkSync('b.md', target);
      await git(['add', '.'], dir);
      const status = (await git(['diff', '--cached', '--name-status'], dir)).trim();
      if (!status.startsWith('T\t')) {
        // Some git configs/platforms report a symlink type-change as D+A
        // instead of T — skip rather than assert a false failure on those.
        return;
      }
      await git(['commit', '-m', 'typechange'], dir);
      const shaB = (await git(['rev-parse', 'HEAD'], dir)).trim();

      const diff = await svc.diffRefs(shaA, shaB, [pagesDir]);
      expect(diff).not.toBeNull();
      const byName = new Map(diff!.files.map((f) => [path.basename(f.path), f.status]));
      expect(byName.get('a.md')).toBe('M');
    });

    it('showFile returns a file\'s content at a given commit, verbatim', async () => {
      const svc = new GitService(dir, [dir]);
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      const filePath = path.join(pagesDir, 'a.md');
      fs.writeFileSync(filePath, '# A v1');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'first'], dir);
      const shaA = (await git(['rev-parse', 'HEAD'], dir)).trim();

      fs.writeFileSync(filePath, '# A v2');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'second'], dir);
      const shaB = (await git(['rev-parse', 'HEAD'], dir)).trim();

      expect(await svc.showFile(shaA, filePath)).toBe('# A v1');
      expect(await svc.showFile(shaB, filePath)).toBe('# A v2');
    });

    it('showFile accepts a precomputed detect() status to skip its own probe', async () => {
      const svc = new GitService(dir, [dir]);
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      const filePath = path.join(pagesDir, 'a.md');
      fs.writeFileSync(filePath, '# A v1');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'first'], dir);
      const shaA = (await git(['rev-parse', 'HEAD'], dir)).trim();

      const precomputed = await svc.detect();
      expect(await svc.showFile(shaA, filePath, precomputed)).toBe('# A v1');
    });

    it('showFile returns null (not throw) for a path that did not exist at that commit', async () => {
      const svc = new GitService(dir, [dir]);
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'first'], dir);
      const shaA = (await git(['rev-parse', 'HEAD'], dir)).trim();

      const newFile = path.join(pagesDir, 'b.md');
      fs.writeFileSync(newFile, '# B');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'second'], dir);

      expect(await svc.showFile(shaA, newFile)).toBeNull();
    });

    it('showFile returns null for a path outside the repo', async () => {
      const svc = new GitService(dir, [dir]);
      fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'first'], dir);
      const shaA = (await git(['rev-parse', 'HEAD'], dir)).trim();

      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-outside-'));
      try {
        expect(await svc.showFile(shaA, path.join(outside, 'x.txt'))).toBeNull();
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('statusAheadBehind returns branch/dirty with null ahead/behind when there is no upstream', async () => {
      const svc = new GitService(dir, [dir]);
      fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'first'], dir);

      const status = await svc.statusAheadBehind();
      expect(status).toEqual({ branch: 'main', isDirty: false, ahead: null, behind: null });
    });

    it('statusAheadBehind reports ahead count against a configured upstream', async () => {
      const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-bare-'));
      await pexec('git', ['init', '--bare', '-b', 'main', bareDir]);
      try {
        const svc = new GitService(dir, [dir]);
        fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
        await git(['add', '.'], dir);
        await git(['commit', '-m', 'first'], dir);
        await git(['remote', 'add', 'origin', bareDir], dir);
        await git(['push', '-u', 'origin', 'main'], dir);

        // One more local commit not yet pushed ⇒ ahead by 1, behind 0.
        fs.writeFileSync(path.join(dir, 'y.txt'), 'y');
        await git(['add', '.'], dir);
        await git(['commit', '-m', 'second'], dir);

        const status = await svc.statusAheadBehind();
        expect(status).toEqual({ branch: 'main', isDirty: false, ahead: 1, behind: 0 });
      } finally {
        fs.rmSync(bareDir, { recursive: true, force: true });
      }
    });

    it('resolveReleaseCommit anchors to the FIRST add, not the most recent, when a file is deleted then re-created at the same path', async () => {
      const svc = new GitService(dir, [dir]);
      const releasesDir = path.join(dir, 'releases');
      fs.mkdirSync(releasesDir, { recursive: true });
      const filePath = path.join(releasesDir, 'v1.json');

      fs.writeFileSync(filePath, '{"n":1}');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'first add'], dir);
      const firstAddSha = (await git(['rev-parse', 'HEAD'], dir)).trim();

      fs.rmSync(filePath);
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'delete'], dir);

      fs.writeFileSync(filePath, '{"n":2}');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 're-add'], dir);

      const resolved = await svc.resolveReleaseCommit(filePath);
      expect(resolved).toBe(firstAddSha);
    });

    it('diffRefs correctly reports status for a file with a non-ASCII (accented) filename', async () => {
      const svc = new GitService(dir, [dir]);
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      const accentedName = 'Wydajność.md';
      fs.writeFileSync(path.join(pagesDir, accentedName), '# v1');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'first'], dir);
      const shaA = (await git(['rev-parse', 'HEAD'], dir)).trim();

      fs.writeFileSync(path.join(pagesDir, accentedName), '# v2');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'second'], dir);
      const shaB = (await git(['rev-parse', 'HEAD'], dir)).trim();

      const diff = await svc.diffRefs(shaA, shaB, [pagesDir]);
      expect(diff).not.toBeNull();
      const byName = new Map(diff!.files.map((f) => [path.basename(f.path), f.status]));
      expect(byName.get(accentedName)).toBe('M');
      // No literal quote/backslash-escaped garbage path leaked through.
      expect(diff!.files.some((f) => f.path.includes('\\') || f.path.includes('"'))).toBe(false);
    });

    it('statusAheadBehind returns null on detached HEAD (no branch to compare)', async () => {
      const svc = new GitService(dir, [dir]);
      fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'first'], dir);
      const sha = (await git(['rev-parse', 'HEAD'], dir)).trim();
      await git(['checkout', sha], dir);

      expect(await svc.statusAheadBehind()).toBeNull();
    });
  });

  describe('commitOnRelease / pushOnPush gating (0.1.118 master switch)', () => {
    it('commitOnRelease returns null when enabled is false', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: false });
      const svc = new GitService(dir, [dir]);
      const result = await svc.commitOnRelease({ name: 'v1', description: 'desc' });
      expect(result).toBeNull();
    });

    it('commitOnRelease proceeds when enabled is true (0.1.124: enabled alone is the gate, no separate sub-toggle)', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      // detect()'s branch probe (`rev-parse --abbrev-ref HEAD`) fails on an
      // unborn branch (zero commits) — seed an initial commit first, same as
      // the other detect()-dependent tests above.
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);

      fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
      const svc = new GitService(dir, [dir]);
      const result = await svc.commitOnRelease({ name: 'v1', description: 'desc' });
      expect(result?.status).toBe('committed');
    });

    it('commitOnRelease stages briefsDir/patchesDir too, so they are actually committed once ensureGitignore un-gitignores them', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);

      // Defaults from server/config.ts: briefsDir='.claude4spec/briefs', patchesDir='.claude4spec/patches'.
      fs.mkdirSync(path.join(dir, '.claude4spec', 'briefs'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude4spec', 'briefs', 'a.md'), '# brief');
      fs.mkdirSync(path.join(dir, '.claude4spec', 'patches'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude4spec', 'patches', 'a.md'), '# patch');

      const svc = new GitService(dir, [dir]);
      const result = await svc.commitOnRelease({ name: 'v1', description: 'desc' });
      expect(result?.status).toBe('committed');

      const tracked = (await git(['ls-tree', '-r', '--name-only', 'HEAD'], dir)).split('\n');
      expect(tracked).toContain('.claude4spec/briefs/a.md');
      expect(tracked).toContain('.claude4spec/patches/a.md');
    });
  });

  describe('commitPull (0.1.124)', () => {
    it('returns skipped when enabled is false', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: false });
      const svc = new GitService(dir, [dir]);
      expect(await svc.commitPull({ name: 'v2' })).toEqual({ status: 'skipped' });
    });

    it('returns skipped when enabled but no repo exists', async () => {
      fs.mkdirSync(dir, { recursive: true });
      writeConfigJson(dir, { enabled: true });
      const svc = new GitService(dir, [dir]);
      expect(await svc.commitPull({ name: 'v2' })).toEqual({ status: 'skipped' });
    });

    it('commits the working tree with a "Pull to <name>" message', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);

      fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
      const svc = new GitService(dir, [dir]);
      const result = await svc.commitPull({ name: 'v2' });
      expect(result.status).toBe('committed');
      const lastMessage = (await git(['log', '-1', '--format=%s'], dir)).trim();
      expect(lastMessage).toBe('Pull to v2');
    });

    it('returns nothing-to-commit on a clean working tree', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);

      const svc = new GitService(dir, [dir]);
      expect(await svc.commitPull({ name: 'v2' })).toEqual({ status: 'nothing-to-commit' });
    });
  });

  /** Install a pre-commit hook that always rejects — deterministically forces `git commit` to fail, independent of any ambient global git config (unlike unsetting user.name/email, which can silently fall back to it). */
  function installFailingPreCommitHook(repoDir: string): void {
    const hooksDir = path.join(repoDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, '#!/bin/sh\necho "rejected by test hook" >&2\nexit 1\n');
    fs.chmodSync(hookPath, 0o755);
  }

  describe('GitErrorRecovery (0.1.124)', () => {
    it('commit failure populates recovery with operation "commit-on-release", reason, gitStderr, and an intentPrompt', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      installFailingPreCommitHook(dir);
      fs.writeFileSync(path.join(dir, 'x.txt'), 'x');

      const svc = new GitService(dir, [dir]);
      const result = await svc.commitOnRelease({ name: 'v1', description: 'desc' });
      expect(result?.status).toBe('error');
      expect(result?.recovery?.operation).toBe('commit-on-release');
      expect(result?.recovery?.reason).toBeTruthy();
      expect(result?.recovery?.gitStderr).toContain('rejected by test hook');
      expect(result?.recovery?.intentPrompt).toContain('committing the spec on release');
      expect(result?.recovery?.intentPrompt.toLowerCase()).toContain('--force');
    });

    it('commitPull failure populates recovery with operation "pull"', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      installFailingPreCommitHook(dir);
      fs.writeFileSync(path.join(dir, 'x.txt'), 'x');

      const svc = new GitService(dir, [dir]);
      const result = await svc.commitPull({ name: 'v2' });
      expect(result.status).toBe('error');
      expect(result.recovery?.operation).toBe('pull');
    });

    it('push failure (no upstream) populates recovery with operation "push"', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);

      const svc = new GitService(dir, [dir]);
      const result = await svc.push();
      expect(result.status).toBe('error');
      expect(result.recovery?.operation).toBe('push');
      expect(result.recovery?.gitStderr).toBeTruthy();
    });
  });

  describe('isAncestorOfHead (0.1.124)', () => {
    it('returns false when enabled is false', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: false });
      const svc = new GitService(dir, [dir]);
      expect(await svc.isAncestorOfHead('HEAD')).toBe(false);
    });

    it('returns true for a commit reachable from HEAD, false for one that is not', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'first'], dir);
      const reachable = (await git(['rev-parse', 'HEAD'], dir)).trim();

      // A commit on an unrelated branch, never merged into main, is NOT an
      // ancestor of main's HEAD.
      await git(['checkout', '-b', 'side'], dir);
      fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'side commit'], dir);
      const unreachableFromMain = (await git(['rev-parse', 'HEAD'], dir)).trim();
      await git(['checkout', 'main'], dir);

      const svc = new GitService(dir, [dir]);
      expect(await svc.isAncestorOfHead(reachable)).toBe(true);
      expect(await svc.isAncestorOfHead(unreachableFromMain)).toBe(false);
    });
  });

  describe('diffRefToWorkingTree (0.1.124)', () => {
    it('reports uncommitted working-tree changes against a commit', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v1');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'first'], dir);
      const shaA = (await git(['rev-parse', 'HEAD'], dir)).trim();

      // Uncommitted: a.md modified, b.md created — never committed.
      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v2');
      fs.writeFileSync(path.join(pagesDir, 'b.md'), '# B v1');

      const svc = new GitService(dir, [dir]);
      const diff = await svc.diffRefToWorkingTree(shaA, [pagesDir]);
      expect(diff).not.toBeNull();
      const byPath = new Map(diff!.files.map((f) => [path.basename(f.path), f.status]));
      expect(byPath.get('a.md')).toBe('M');
      expect(byPath.get('b.md')).toBe('A');
    });

    it('returns null when git.enabled is false', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: false });
      const svc = new GitService(dir, [dir]);
      expect(await svc.diffRefToWorkingTree('HEAD', [dir])).toBeNull();
    });
  });

  describe('listBranches (0.1.123)', () => {
    it('returns {current: null, branches: []} when git.enabled is false', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: false });
      const svc = new GitService(dir, [dir]);
      expect(await svc.listBranches()).toEqual({ current: null, branches: [] });
    });

    it('returns {current: null, branches: []} when enabled but no repo exists', async () => {
      fs.mkdirSync(dir, { recursive: true });
      writeConfigJson(dir, { enabled: true });
      const svc = new GitService(dir, [dir]);
      expect(await svc.listBranches()).toEqual({ current: null, branches: [] });
    });

    it('lists local branches with the correct current branch', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      await git(['checkout', '-b', 'feature'], dir);
      await git(['checkout', 'main'], dir);

      const svc = new GitService(dir, [dir]);
      const result = await svc.listBranches();
      expect(result.current).toBe('main');
      expect(result.branches.sort()).toEqual(['feature', 'main']);
    });

    it('is non-empty in detached HEAD, with current: null', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      const sha = (await git(['rev-parse', 'HEAD'], dir)).trim();
      await git(['checkout', sha], dir);

      const svc = new GitService(dir, [dir]);
      const result = await svc.listBranches();
      expect(result.current).toBeNull();
      expect(result.branches).toContain('main');
    });
  });

  describe('checkout (0.1.123)', () => {
    it('returns skipped when git.enabled is false', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: false });
      const svc = new GitService(dir, [dir]);
      expect(await svc.checkout('main')).toEqual({ status: 'skipped', branch: null, message: null });
    });

    it('returns skipped when enabled but no repo exists', async () => {
      fs.mkdirSync(dir, { recursive: true });
      writeConfigJson(dir, { enabled: true });
      const svc = new GitService(dir, [dir]);
      expect(await svc.checkout('main')).toEqual({ status: 'skipped', branch: null, message: null });
    });

    it('returns busy when an agent turn is in flight, before any git mutation', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      await git(['checkout', '-b', 'feature'], dir);
      await git(['checkout', 'main'], dir);

      const svc = new GitService(dir, [dir], () => true);
      const result = await svc.checkout('feature');
      expect(result.status).toBe('busy');
      expect(result.message).toMatch(/background task/i);
      // HEAD did not move.
      expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim()).toBe('main');
    });

    it('returns dirty-blocked when a tracked file is modified (uncommitted)', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'tracked.txt'), 'v1');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      await git(['checkout', '-b', 'feature'], dir);
      await git(['checkout', 'main'], dir);
      fs.writeFileSync(path.join(dir, 'tracked.txt'), 'v2 (uncommitted)');

      const svc = new GitService(dir, [dir]);
      const result = await svc.checkout('feature');
      expect(result.status).toBe('dirty-blocked');
      expect(result.message).toMatch(/commit or stash/i);
    });

    it('does NOT block on an untracked file alone (regression)', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      await git(['checkout', '-b', 'feature'], dir);
      await git(['checkout', 'main'], dir);
      fs.writeFileSync(path.join(dir, 'untracked.txt'), 'never added');

      const svc = new GitService(dir, [dir]);
      const result = await svc.checkout('feature');
      expect(result.status).toBe('switched');
      expect(result.branch).toBe('feature');
    });

    it('returns not-found for a nonexistent branch', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);

      const svc = new GitService(dir, [dir]);
      const result = await svc.checkout('does-not-exist');
      expect(result).toEqual({
        status: 'not-found',
        branch: null,
        message: 'Branch "does-not-exist" was not found.',
      });
    });

    it('switches HEAD on the happy path', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      await git(['checkout', '-b', 'feature'], dir);
      await git(['checkout', 'main'], dir);

      const svc = new GitService(dir, [dir]);
      const result = await svc.checkout('feature');
      expect(result).toEqual({ status: 'switched', branch: 'feature', message: null });
      expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim()).toBe('feature');
    });

    it('returns error (not dirty-blocked) when git refuses the checkout due to an untracked-file collision', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true });
      // main: seed commit.
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      // feature: tracks x.txt with content A.
      await git(['checkout', '-b', 'feature'], dir);
      fs.writeFileSync(path.join(dir, 'x.txt'), 'content on feature');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'add x on feature'], dir);
      // Back on main: x.txt is untracked here, with DIFFERENT content — git
      // refuses to check out feature because it would overwrite it.
      await git(['checkout', 'main'], dir);
      fs.writeFileSync(path.join(dir, 'x.txt'), 'different untracked content on main');

      const svc = new GitService(dir, [dir]);
      const result = await svc.checkout('feature');
      expect(result.status).toBe('error');
      expect(result.message).toBeTruthy();
      // Still on main — the checkout never happened.
      expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim()).toBe('main');
    });
  });

  describe('commitTarget (0.1.125)', () => {
    it('mode "named" commits onto an existing branch tip via temp index — HEAD/working tree/real index untouched', async () => {
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      await git(['branch', 'release-target'], dir);
      const mainShaBefore = (await git(['rev-parse', 'main'], dir)).trim();

      writeConfigJson(dir, { enabled: true, commitTarget: { mode: 'named', branch: 'release-target' } });
      // Uncommitted "captured spec delta" on main — never staged to the real index.
      fs.writeFileSync(path.join(dir, 'new-spec.txt'), 'captured delta');

      const svc = new GitService(dir, [dir]);
      const result = await svc.commit({ name: 'v1', description: '' });
      expect(result.status).toBe('committed');
      expect(result.branch).toBe('release-target');

      // HEAD/current branch untouched.
      expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim()).toBe('main');
      expect((await git(['rev-parse', 'main'], dir)).trim()).toBe(mainShaBefore);
      // Real index/working tree untouched — the new file is still untracked on main.
      const porcelain = (await git(['status', '--porcelain'], dir)).trim();
      expect(porcelain).toContain('?? new-spec.txt');
      // The new commit landed on release-target and contains the file.
      const tracked = (await git(['ls-tree', '-r', '--name-only', 'release-target'], dir)).split('\n');
      expect(tracked).toContain('new-spec.txt');
    });

    it('mode "named" returns nothing-to-commit when the tree is already identical to the target tip', async () => {
      await initRepo(dir);
      // Write + commit config.json itself, so it's already identical on both
      // branches — writing it AFTER the seed commit would introduce a real
      // (untracked config.json) diff and defeat the nothing-to-commit case.
      writeConfigJson(dir, { enabled: true, commitTarget: { mode: 'named', branch: 'release-target' } });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      await git(['branch', 'release-target'], dir);

      const svc = new GitService(dir, [dir]);
      const result = await svc.commit({ name: 'v1', description: '' });
      expect(result.status).toBe('nothing-to-commit');
    });

    it('mode "named" returns branch-missing when the configured branch does not exist', async () => {
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);

      writeConfigJson(dir, { enabled: true, commitTarget: { mode: 'named', branch: 'does-not-exist' } });
      const svc = new GitService(dir, [dir]);
      const result = await svc.commit({ name: 'v1', description: '' });
      expect(result.status).toBe('error');
      expect(result.recovery?.kind).toBe('branch-missing');
    });

    it('mode "new" grows the new branch from the BASE tip, never from HEAD, even when HEAD is elsewhere', async () => {
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      const mainTip = (await git(['rev-parse', 'main'], dir)).trim();

      // HEAD moves to a divergent branch with its own extra commit.
      await git(['checkout', '-b', 'other'], dir);
      fs.writeFileSync(path.join(dir, 'other-only.txt'), 'other');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'other commit'], dir);

      writeConfigJson(dir, {
        enabled: true,
        commitTarget: { mode: 'new', template: 'release-{date}', base: 'main' },
      });
      fs.writeFileSync(path.join(dir, 'new-spec.txt'), 'captured delta');

      const svc = new GitService(dir, [dir]);
      const result = await svc.commit({ name: 'v1', description: '' });
      expect(result.status).toBe('committed');
      expect(result.branch).toBeTruthy();

      const parentSha = (await git(['rev-parse', `${result.branch}~1`], dir)).trim();
      expect(parentSha).toBe(mainTip);
      // HEAD is still on 'other' — never touched.
      expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim()).toBe('other');
    });

    it('mode "new" suffixes the rendered branch name on collision', async () => {
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      await git(['branch', 'release-fixed'], dir);

      writeConfigJson(dir, {
        enabled: true,
        commitTarget: { mode: 'new', template: 'release-fixed', base: 'main' },
      });
      fs.writeFileSync(path.join(dir, 'new-spec.txt'), 'captured delta');

      const svc = new GitService(dir, [dir]);
      const result = await svc.commit({ name: 'v1', description: '' });
      expect(result.status).toBe('committed');
      expect(result.branch).toBe('release-fixed-2');
    });

    it('mode "new" returns base-missing when the explicit base branch does not exist', async () => {
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);

      writeConfigJson(dir, {
        enabled: true,
        commitTarget: { mode: 'new', template: 'release-{date}', base: 'does-not-exist' },
      });
      const svc = new GitService(dir, [dir]);
      const result = await svc.commit({ name: 'v1', description: '' });
      expect(result.status).toBe('error');
      expect(result.recovery?.kind).toBe('base-missing');
    });

    it('mode "new" with base: null returns base-missing in a repo with no commits at all', async () => {
      fs.mkdirSync(dir, { recursive: true });
      await pexec('git', ['init', '-b', 'main'], { cwd: dir });
      writeConfigJson(dir, {
        enabled: true,
        commitTarget: { mode: 'new', template: 'release-{date}', base: null },
      });
      const svc = new GitService(dir, [dir]);
      const result = await svc.commit({ name: 'v1', description: '' });
      expect(result.status).toBe('error');
      expect(result.recovery?.kind).toBe('base-missing');
    });

    it('switchAfterRelease switches HEAD to the target branch on success', async () => {
      await initRepo(dir);
      // Write + commit config.json itself, so checkout doesn't have to adopt
      // it as a brand-new untracked file (see the nothing-to-commit test's
      // comment above for why that matters).
      writeConfigJson(dir, {
        enabled: true,
        commitTarget: { mode: 'named', branch: 'release-target' },
        switchAfterRelease: true,
      });
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      await git(['branch', 'release-target'], dir);

      fs.writeFileSync(path.join(dir, 'new-spec.txt'), 'captured delta');

      const svc = new GitService(dir, [dir]);
      const result = await svc.commit({ name: 'v1', description: '' });
      expect(result.status).toBe('committed');
      expect(result.switched).toBe(true);
      expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim()).toBe('release-target');
    });

    it('switchAfterRelease reports switch-dirty (commit still durable) when an out-of-scope tracked file genuinely conflicts', async () => {
      // Narrow the releasable root to `pages/` only, so README.md (repo root)
      // is "outside spec" — the brief's switch-dirty scenario needs a
      // conflicting file that ISN'T part of what commitForRelease stages
      // (a staged file's target-branch content always matches the working
      // tree exactly right after the commit, so it can never itself produce
      // a real checkout conflict).
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'README.md'), 'orig');
      fs.writeFileSync(path.join(pagesDir, 'index.md'), 'page1');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);

      await git(['checkout', '-b', 'release-target'], dir);
      fs.writeFileSync(path.join(dir, 'README.md'), 'target-version');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'readme on target'], dir);
      await git(['checkout', 'main'], dir);

      // Uncommitted, tracked, out-of-scope change that conflicts with BOTH
      // main's and release-target's committed README.md.
      fs.writeFileSync(path.join(dir, 'README.md'), 'dirty-version');
      // A genuine in-scope spec delta so the commit itself has something to do.
      fs.writeFileSync(path.join(pagesDir, 'index2.md'), 'page2');

      writeConfigJson(dir, {
        enabled: true,
        commitTarget: { mode: 'named', branch: 'release-target' },
        switchAfterRelease: true,
      });
      const svc = new GitService(dir, [pagesDir]);
      const result = await svc.commit({ name: 'v1', description: '' });

      expect(result.status).toBe('error');
      expect(result.branch).toBe('release-target');
      expect(result.recovery?.kind).toBe('switch-dirty');
      // Still on main — the switch never happened, but the commit is durable.
      expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim()).toBe('main');
      const tracked = (await git(['ls-tree', '-r', '--name-only', 'release-target'], dir)).split('\n');
      expect(tracked).toContain('pages/index2.md');
    });

    it('resolveReleaseCommit finds the marker via --all when its FIRST add is only reachable from a non-current branch', async () => {
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      await git(['branch', 'release-target'], dir);

      // The release identity file is added FOR THE FIRST TIME by the
      // commit-target commit itself, which lands on release-target — main
      // (current HEAD) never has this path in its history at all, so a
      // plain (non---all) `git log` from main would find nothing.
      const filePath = path.join(dir, 'v1.json');
      writeConfigJson(dir, { enabled: true, commitTarget: { mode: 'named', branch: 'release-target' } });
      fs.writeFileSync(filePath, '{}');
      const svc = new GitService(dir, [dir]);
      const commitResult = await svc.commit({ name: 'v1', description: '' });
      expect(commitResult.status).toBe('committed');

      // Sanity check: a non---all log from current HEAD truly finds nothing.
      const withoutAll = (
        await pexec('git', ['log', '--diff-filter=A', '--format=%H', '--', filePath], { cwd: dir })
      ).stdout.trim();
      expect(withoutAll).toBe('');

      // HEAD is still main — resolveReleaseCommit must use --all to find the
      // marker on release-target.
      const markerSha = await svc.resolveReleaseCommit(filePath);
      expect(markerSha).toBeTruthy();
      const shaOnTarget = (
        await pexec('git', ['log', '--all', '--diff-filter=A', '--format=%H', '--', filePath], { cwd: dir })
      ).stdout
        .trim()
        .split('\n')
        .pop();
      expect(markerSha).toBe(shaOnTarget);
    });

    it('branchContainingCommit finds the branch carrying a given sha, preferring current when ambiguous', async () => {
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      const sha = (await git(['rev-parse', 'HEAD'], dir)).trim();
      await git(['branch', 'other'], dir);

      writeConfigJson(dir, { enabled: true });
      const svc = new GitService(dir, [dir]);
      // Both 'main' (current) and 'other' contain this commit — current wins.
      expect(await svc.branchContainingCommit(sha)).toBe('main');
    });

    it('push(branch) pushes an explicit non-current branch via `git push origin <branch>`', async () => {
      const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-bare-'));
      await pexec('git', ['init', '--bare', '-b', 'main', bareDir], {});
      try {
        await initRepo(dir);
        fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
        await git(['add', '.'], dir);
        await git(['commit', '-m', 'seed'], dir);
        await git(['remote', 'add', 'origin', bareDir], dir);
        await git(['push', '-u', 'origin', 'main'], dir);
        await git(['branch', 'other'], dir);

        writeConfigJson(dir, { enabled: true });
        const svc = new GitService(dir, [dir]);
        const result = await svc.push('other');
        expect(result.status).toBe('pushed');
        expect(result.branch).toBe('other');

        const remoteBranches = (await pexec('git', ['branch', '--format=%(refname:short)'], { cwd: bareDir })).stdout;
        expect(remoteBranches).toContain('other');
      } finally {
        fs.rmSync(bareDir, { recursive: true, force: true });
      }
    });

    it('mode "named" preserves content unique to the target branch that current HEAD never had (code review regression)', async () => {
      // Narrow releasable root to `sub/` so `sub/fileA.txt` (present on the
      // target branch's own history, absent from current HEAD's) is
      // in-scope, and the bug (naively `git add`-ing from a target-tip-seeded
      // index silently stages a deletion for anything tracked-there-but-
      // missing-on-disk) would otherwise delete it.
      const subDir = path.join(dir, 'sub');
      fs.mkdirSync(subDir, { recursive: true });
      await initRepo(dir);
      fs.writeFileSync(path.join(subDir, 'fileA.txt'), 'a');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed with fileA'], dir);
      await git(['branch', 'release-target'], dir);

      // On CURRENT branch (main), fileA.txt is removed — it never existed
      // as far as main's own history is concerned going forward.
      fs.rmSync(path.join(subDir, 'fileA.txt'));
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'remove fileA on main'], dir);

      writeConfigJson(dir, { enabled: true, commitTarget: { mode: 'named', branch: 'release-target' } });
      fs.writeFileSync(path.join(subDir, 'fileB.txt'), 'b');

      const svc = new GitService(dir, [subDir]);
      const result = await svc.commit({ name: 'v1', description: '' });
      expect(result.status).toBe('committed');

      const tracked = (await git(['ls-tree', '-r', '--name-only', 'release-target'], dir)).split('\n');
      expect(tracked).toContain('sub/fileA.txt'); // preserved — unrelated to this release
      expect(tracked).toContain('sub/fileB.txt'); // the actual release delta
    });

    it('mode "named" targeting the CURRENTLY CHECKED-OUT branch commits via the real index, leaving git status clean (code review regression)', async () => {
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      writeConfigJson(dir, { enabled: true, commitTarget: { mode: 'named', branch: 'main' } });
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);

      fs.writeFileSync(path.join(dir, 'new-spec.txt'), 'captured delta');
      const svc = new GitService(dir, [dir]);
      const result = await svc.commit({ name: 'v1', description: '' });
      expect(result.status).toBe('committed');
      expect(result.branch).toBe('main');

      const porcelain = (await git(['status', '--porcelain'], dir)).trim();
      expect(porcelain).toBe(''); // clean — not the "staged-deletion + untracked" corruption
      expect((await git(['ls-tree', '-r', '--name-only', 'HEAD'], dir)).split('\n')).toContain('new-spec.txt');
    });

    it('commitOnRelease commits on detached HEAD when mode is "named" (branch-independent by design; code review regression)', async () => {
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      await git(['branch', 'release-target'], dir);
      const sha = (await git(['rev-parse', 'HEAD'], dir)).trim();
      await git(['checkout', sha], dir); // detached HEAD

      writeConfigJson(dir, { enabled: true, commitTarget: { mode: 'named', branch: 'release-target' } });
      fs.writeFileSync(path.join(dir, 'new-spec.txt'), 'captured delta');

      const svc = new GitService(dir, [dir]);
      const result = await svc.commitOnRelease({ name: 'v1', description: '' });
      expect(result?.status).toBe('committed');
      expect(result?.branch).toBe('release-target');
    });

    it('commitOnRelease still returns null on detached HEAD when mode is "current" (unchanged default behavior)', async () => {
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      const sha = (await git(['rev-parse', 'HEAD'], dir)).trim();
      await git(['checkout', sha], dir); // detached HEAD

      writeConfigJson(dir, { enabled: true });
      const svc = new GitService(dir, [dir]);
      const result = await svc.commitOnRelease({ name: 'v1', description: '' });
      expect(result).toBeNull();
    });

    it('push(branch) pushes an explicit branch even on detached HEAD (code review regression)', async () => {
      const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-bare-'));
      await pexec('git', ['init', '--bare', '-b', 'main', bareDir], {});
      try {
        await initRepo(dir);
        fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
        await git(['add', '.'], dir);
        await git(['commit', '-m', 'seed'], dir);
        await git(['remote', 'add', 'origin', bareDir], dir);
        await git(['push', '-u', 'origin', 'main'], dir);
        await git(['branch', 'other'], dir);
        const sha = (await git(['rev-parse', 'HEAD'], dir)).trim();
        await git(['checkout', sha], dir); // detached HEAD

        writeConfigJson(dir, { enabled: true });
        const svc = new GitService(dir, [dir]);
        const result = await svc.push('other');
        expect(result.status).toBe('pushed');
        expect(result.branch).toBe('other');
      } finally {
        fs.rmSync(bareDir, { recursive: true, force: true });
      }
    });

    it('push() with no explicit branch still returns skipped on detached HEAD (unchanged default behavior)', async () => {
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      const sha = (await git(['rev-parse', 'HEAD'], dir)).trim();
      await git(['checkout', sha], dir);

      writeConfigJson(dir, { enabled: true });
      const svc = new GitService(dir, [dir]);
      const result = await svc.push();
      expect(result).toEqual({ status: 'skipped', message: 'detached HEAD' });
    });

    it('switchAfterRelease rolls back the real-index staging when the switch fails (code review regression)', async () => {
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'README.md'), 'orig');
      fs.writeFileSync(path.join(pagesDir, 'index.md'), 'page1');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);

      await git(['checkout', '-b', 'release-target'], dir);
      fs.writeFileSync(path.join(dir, 'README.md'), 'target-version');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'readme on target'], dir);
      await git(['checkout', 'main'], dir);

      fs.writeFileSync(path.join(dir, 'README.md'), 'dirty-version');
      fs.writeFileSync(path.join(pagesDir, 'index2.md'), 'page2');

      writeConfigJson(dir, {
        enabled: true,
        commitTarget: { mode: 'named', branch: 'release-target' },
        switchAfterRelease: true,
      });
      const svc = new GitService(dir, [pagesDir]);
      const result = await svc.commit({ name: 'v1', description: '' });
      expect(result.status).toBe('error');
      expect(result.recovery?.kind).toBe('switch-dirty');

      // The real index must NOT be left holding pages/index2.md staged on
      // main — that would be invisible to the caller and would land inside
      // whatever main's NEXT unrelated commit happens to be.
      const staged = (await git(['diff', '--cached', '--name-only'], dir)).trim();
      expect(staged).toBe('');
    });

    it('switchAfterCommit refuses to switch while an agent turn is in flight (code review regression)', async () => {
      await initRepo(dir);
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'seed'], dir);
      await git(['branch', 'release-target'], dir);

      writeConfigJson(dir, {
        enabled: true,
        commitTarget: { mode: 'named', branch: 'release-target' },
        switchAfterRelease: true,
      });
      fs.writeFileSync(path.join(dir, 'new-spec.txt'), 'captured delta');

      const svc = new GitService(dir, [dir], () => true); // always busy
      const result = await svc.commit({ name: 'v1', description: '' });
      // The commit itself still succeeds — only the switch is refused.
      expect(result.status).toBe('error');
      expect(result.recovery?.kind).toBe('switch-failed');
      expect(result.branch).toBe('release-target');
      expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim()).toBe('main');
      const tracked = (await git(['ls-tree', '-r', '--name-only', 'release-target'], dir)).split('\n');
      expect(tracked).toContain('new-spec.txt');
    });
  });

  describe('resolveReleaseCommit --all fallback ordering (code review regression, 0.1.125)', () => {
    let dir2: string;
    beforeEach(() => {
      dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-git-svc-2-'));
    });
    afterEach(() => {
      fs.rmSync(dir2, { recursive: true, force: true });
    });

    it('prefers the HEAD-scoped search over --all when the marker is reachable from HEAD', async () => {
      await initRepo(dir2);
      const filePath = path.join(dir2, 'v1.json');
      fs.writeFileSync(filePath, '{}');
      await pexec('git', ['add', '.'], { cwd: dir2 });
      await pexec('git', ['commit', '-m', 'add marker'], { cwd: dir2 });
      const dir2Config = path.join(dir2, '.claude4spec');
      fs.mkdirSync(dir2Config, { recursive: true });
      fs.writeFileSync(
        path.join(dir2Config, 'config.json'),
        JSON.stringify({ $schemaVersion: 4, name: 'test', git: { enabled: true } }, null, 2),
      );
      const svc = new GitService(dir2, [dir2]);
      const sha = await svc.resolveReleaseCommit(filePath);
      const headSha = (await pexec('git', ['rev-parse', 'HEAD'], { cwd: dir2 })).stdout.trim();
      expect(sha).toBe(headSha);
    });
  });
});

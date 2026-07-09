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
    });

    it('all three return null (not throw) when git.enabled is true but no repo exists', async () => {
      fs.mkdirSync(dir, { recursive: true });
      writeConfigJson(dir, { enabled: true });
      const svc = new GitService(dir, [dir]);

      expect(await svc.resolveReleaseCommit(path.join(dir, 'foo.json'))).toBeNull();
      expect(await svc.diffRefs('HEAD~1', 'HEAD', [dir])).toBeNull();
      expect(await svc.statusAheadBehind()).toBeNull();
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
    it('commitOnRelease returns null when enabled is false even if syncCommitOnRelease is true (B1 regression)', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: false, syncCommitOnRelease: true });
      const svc = new GitService(dir, [dir]);
      const result = await svc.commitOnRelease({ name: 'v1', description: 'desc' });
      expect(result).toBeNull();
    });

    it('commitOnRelease proceeds when enabled and syncCommitOnRelease are both true', async () => {
      await initRepo(dir);
      writeConfigJson(dir, { enabled: true, syncCommitOnRelease: true });
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
      writeConfigJson(dir, { enabled: true, syncCommitOnRelease: true });
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
});

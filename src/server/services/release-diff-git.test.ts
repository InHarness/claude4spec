import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { ReleaseFileStore } from './release-store.js';
import { ReleasesWatcher } from '../fs/releases-watcher.js';
import { GitService } from './git.js';
import { PageSerializer } from './page-serializer.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { VersionService } from './versions.js';
import type { PageVersionService } from './page-version.js';
import type { RawEntityReader } from '../domain/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';

const pexec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd });
  return stdout;
}

// Minimal fakes for ReleaseService constructor params the git-anchored branch
// never touches (host is touched by the SQL-fallback path's getReleaseSnapshot,
// so it needs just enough shape not to throw). `pageSerializer` is a REAL
// instance (0.1.124: the git-anchored path now runs real section diffing) —
// its `snapshotFromContent`/`diff` methods never touch `this.pages`, only the
// (here-unused) `snapshot()` does, so a shapeless fake PagesService is safe.
const fakeHost = { getEntity: () => null } as unknown as PluginHost;
const fakePagesService = {} as unknown as PagesService;
const fakePageSerializer = new PageSerializer(fakePagesService);
const fakeVersions = {} as unknown as VersionService;
const fakePageVersions = {} as unknown as PageVersionService;
const fakeRawReader = {} as unknown as RawEntityReader;
const fakeTagsService = {} as unknown as TagsService;

describe('ReleaseService.getReleaseDiff — git-anchored branch (0.1.118)', () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-release-diff-git-'));
    db = new Database(':memory:');
    runMigrations(db);

    await pexec('git', ['init', '-b', 'main'], { cwd: dir });
    await pexec('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await pexec('git', ['config', 'user.name', 'Test'], { cwd: dir });

    const claude4specDir = path.join(dir, '.claude4spec');
    fs.mkdirSync(claude4specDir, { recursive: true });
    fs.writeFileSync(
      path.join(claude4specDir, 'config.json'),
      JSON.stringify({ $schemaVersion: 4, name: 'test', git: { enabled: true } }, null, 2),
    );
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function buildReleaseService(pagesDir: string): {
    releaseService: ReleaseService;
    releaseStore: ReleaseFileStore;
    gitService: GitService;
  } {
    const releasesWatcher = new ReleasesWatcher(path.join(dir, '.claude4spec/releases'));
    const releaseStore = new ReleaseFileStore(dir, '.claude4spec/releases', releasesWatcher);
    releaseStore.ensureRoot();
    const gitService = new GitService(dir, [pagesDir]);

    const releaseService = new ReleaseService(
      db,
      fakeHost,
      fakeVersions,
      fakePageVersions,
      fakePageSerializer,
      fakeRawReader,
      fakeTagsService,
      fakePagesService,
      null,
      dir,
      ['pages'],
      [pagesDir],
    );
    releaseService.setReleaseStore(releaseStore);
    releaseService.setGitService(gitService);
    return { releaseService, releaseStore, gitService };
  }

  function buildReleaseServiceMultiRoot(
    rootIds: string[],
    rootDirs: string[],
  ): { releaseService: ReleaseService; releaseStore: ReleaseFileStore } {
    const releasesWatcher = new ReleasesWatcher(path.join(dir, '.claude4spec/releases'));
    const releaseStore = new ReleaseFileStore(dir, '.claude4spec/releases', releasesWatcher);
    releaseStore.ensureRoot();
    const gitService = new GitService(dir, rootDirs);

    const releaseService = new ReleaseService(
      db,
      fakeHost,
      fakeVersions,
      fakePageVersions,
      fakePageSerializer,
      fakeRawReader,
      fakeTagsService,
      fakePagesService,
      null,
      dir,
      rootIds,
      rootDirs,
    );
    releaseService.setReleaseStore(releaseStore);
    releaseService.setGitService(gitService);
    return { releaseService, releaseStore };
  }

  it('sources from git history when both releases are anchored, producing full section-level page diffs', async () => {
    const pagesDir = path.join(dir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    const { releaseService, releaseStore } = buildReleaseService(pagesDir);

    fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v1');
    const info1 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v1', 'v1', 'First', 'user');
    const v1Id = Number(info1.lastInsertRowid);
    releaseStore.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First',
      createdAt: new Date(0).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v1'], dir);

    fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v2');
    fs.writeFileSync(path.join(pagesDir, 'b.md'), '# B v1');
    const info2 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v2', 'v2', 'Second', 'user');
    const v2Id = Number(info2.lastInsertRowid);
    releaseStore.write('v2', {
      name: 'v2',
      slug: 'v2',
      description: 'Second',
      createdAt: new Date(1).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v2'], dir);

    const delta = await releaseService.getReleaseDiff(v1Id, v2Id);

    expect(delta.from).toEqual({ id: v1Id, name: 'v1' });
    expect(delta.to).toEqual({ id: v2Id, name: 'v2' });
    const byPath = new Map(delta.pages.map((p) => [p.path, p]));
    const aChange = byPath.get('a.md');
    expect(aChange?.op).toBe('modified');
    // 0.1.124: the git-anchored path now reads old/new content per commit and
    // runs the real section/line-diff algorithm — no more hardcoded empties.
    expect(aChange?.modified_sections.length).toBe(1);
    const lines = aChange?.modified_sections[0]?.line_diff.lines ?? [];
    expect(lines.some((l) => l.op === 'removed' && l.content === '# A v1')).toBe(true);
    expect(lines.some((l) => l.op === 'added' && l.content === '# A v2')).toBe(true);

    const bChange = byPath.get('b.md');
    expect(bChange?.op).toBe('created');
    expect(bChange?.added_sections.length).toBe(1);
    expect(bChange?.added_sections[0]?.content).toBe('# B v1');

    expect(delta.entities).toEqual([]);
  });

  it('resolves a renamed page (diffRefs-flattened D+A pair) to clean deleted/created entries, not modified', async () => {
    const pagesDir = path.join(dir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    const { releaseService, releaseStore } = buildReleaseService(pagesDir);

    fs.writeFileSync(path.join(pagesDir, 'old-name.md'), '# Content');
    const info1 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v1', 'v1', 'First', 'user');
    const v1Id = Number(info1.lastInsertRowid);
    releaseStore.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First',
      createdAt: new Date(0).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v1'], dir);

    fs.renameSync(path.join(pagesDir, 'old-name.md'), path.join(pagesDir, 'new-name.md'));
    const info2 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v2', 'v2', 'Second', 'user');
    const v2Id = Number(info2.lastInsertRowid);
    releaseStore.write('v2', {
      name: 'v2',
      slug: 'v2',
      description: 'Second',
      createdAt: new Date(1).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'rename'], dir);

    const delta = await releaseService.getReleaseDiff(v1Id, v2Id);

    const byPath = new Map(delta.pages.map((p) => [p.path, p]));
    expect(byPath.get('old-name.md')?.op).toBe('deleted');
    expect(byPath.get('old-name.md')?.removed_sections[0]?.content).toBe('# Content');
    expect(byPath.get('new-name.md')?.op).toBe('created');
    expect(byPath.get('new-name.md')?.added_sections[0]?.content).toBe('# Content');
  });

  it('degrades a page with malformed historical frontmatter to file-level status instead of crashing the whole diff', async () => {
    const pagesDir = path.join(dir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    const { releaseService, releaseStore } = buildReleaseService(pagesDir);

    fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v1');
    const info1 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v1', 'v1', 'First', 'user');
    const v1Id = Number(info1.lastInsertRowid);
    releaseStore.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First',
      createdAt: new Date(0).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v1'], dir);

    // Malformed YAML frontmatter (unbalanced flow sequence) — gray-matter
    // throws parsing this. Simulates content committed before/outside the
    // app's own write-time validation.
    fs.writeFileSync(path.join(pagesDir, 'a.md'), '---\nfoo: [1, 2\n---\n# A v2');
    const info2 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v2', 'v2', 'Second', 'user');
    const v2Id = Number(info2.lastInsertRowid);
    releaseStore.write('v2', {
      name: 'v2',
      slug: 'v2',
      description: 'Second',
      createdAt: new Date(1).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v2'], dir);

    const delta = await releaseService.getReleaseDiff(v1Id, v2Id);

    const aChange = delta.pages.find((p) => p.path === 'a.md');
    expect(aChange?.op).toBe('modified');
    expect(aChange?.modified_sections).toEqual([]);
    expect(aChange?.added_sections).toEqual([]);
  });

  it('degrades a real modification to file-level status (not a false "created") when reading one side\'s content fails', async () => {
    const pagesDir = path.join(dir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    const { releaseService, releaseStore, gitService } = buildReleaseService(pagesDir);

    fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v1');
    const info1 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v1', 'v1', 'First', 'user');
    const v1Id = Number(info1.lastInsertRowid);
    releaseStore.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First',
      createdAt: new Date(0).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v1'], dir);
    const shaA = (await git(['rev-parse', 'HEAD'], dir)).trim();

    fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v2');
    const info2 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v2', 'v2', 'Second', 'user');
    const v2Id = Number(info2.lastInsertRowid);
    releaseStore.write('v2', {
      name: 'v2',
      slug: 'v2',
      description: 'Second',
      createdAt: new Date(1).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v2'], dir);

    // Simulate a transient read failure on the OLD side only (a.md at v1 is
    // a real, existing commit — this is NOT a legitimate create/delete
    // boundary). `showFile`'s contract can't distinguish "doesn't exist at
    // this commit" from "failed for some other reason", so tryGitAnchoredDiff
    // must not trust pageSerializer.diff's null-based op inference here.
    const original = gitService.showFile.bind(gitService);
    vi.spyOn(gitService, 'showFile').mockImplementation(async (sha, absPath, precomputed) => {
      if (sha === shaA) return null;
      return original(sha, absPath, precomputed);
    });

    const delta = await releaseService.getReleaseDiff(v1Id, v2Id);

    const aChange = delta.pages.find((p) => p.path === 'a.md');
    expect(aChange?.op).toBe('modified'); // NOT 'created'
    expect(aChange?.added_sections).toEqual([]); // degraded, not a false full-content add
  });

  it('falls back to the SQL path when a release predates git history (no backing file, slug = NULL)', async () => {
    const pagesDir = path.join(dir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    const { releaseService } = buildReleaseService(pagesDir);

    // Two legacy releases in SQLite with no backing file/commit — the file
    // migration (045) leaves slug = NULL for rows born before this feature.
    const info1 = db
      .prepare(`INSERT INTO spec_release (name, description, created_by) VALUES (?, ?, ?)`)
      .run('legacy-1', 'First', 'user');
    const info2 = db
      .prepare(`INSERT INTO spec_release (name, description, created_by) VALUES (?, ?, ?)`)
      .run('legacy-2', 'Second', 'user');

    const delta = await releaseService.getReleaseDiff(
      Number(info1.lastInsertRowid),
      Number(info2.lastInsertRowid),
    );
    // SQL fallback taken (no entity_version/page_version rows exist for these
    // ids either) — proves tryGitAnchoredDiff correctly declined on slug=null.
    expect(delta.entities).toEqual([]);
    expect(delta.pages).toEqual([]);
  });

  it('falls back to the SQL path when git.enabled is false, even if both releases have files committed', async () => {
    const pagesDir = path.join(dir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude4spec/config.json'),
      JSON.stringify({ $schemaVersion: 4, name: 'test', git: { enabled: false } }, null, 2),
    );
    const { releaseService, releaseStore } = buildReleaseService(pagesDir);

    fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v1');
    const info1 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v1', 'v1', 'First', 'user');
    releaseStore.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First',
      createdAt: new Date(0).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    const info2 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v2', 'v2', 'Second', 'user');
    releaseStore.write('v2', {
      name: 'v2',
      slug: 'v2',
      description: 'Second',
      createdAt: new Date(1).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'both releases, git disabled'], dir);

    const delta = await releaseService.getReleaseDiff(
      Number(info1.lastInsertRowid),
      Number(info2.lastInsertRowid),
    );
    expect(delta.entities).toEqual([]);
    expect(delta.pages).toEqual([]);
  });

  // 0.1.118 code-review fix: two adjacent releases whose identity files land
  // in the SAME commit (e.g. a rename that skipped a commit — B3 — followed
  // by a later release whose commit swept up both the pending rename and the
  // new file) used to make tryGitAnchoredDiff resolve shaA === shaB, call
  // diffRefs(sha, sha, ...) (trivially {files: []}), and accept that
  // non-null-but-empty result as "no changes" — silently hiding any real
  // content differences. It must now decline (return null) so the caller
  // falls back to the SQL path instead.
  it('declines (falls back to SQL) when both releases resolve to the SAME commit, instead of returning a falsely-empty diff', async () => {
    const pagesDir = path.join(dir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    const { releaseService, releaseStore } = buildReleaseService(pagesDir);

    // Both release-identity files AND a real content change land in one commit.
    fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v1');
    releaseStore.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First',
      createdAt: new Date(0).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    releaseStore.write('v2', {
      name: 'v2',
      slug: 'v2',
      description: 'Second',
      createdAt: new Date(1).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v1 and v2 land together'], dir);

    const info1 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v1', 'v1', 'First', 'user');
    const info2 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v2', 'v2', 'Second', 'user');
    const v1Id = Number(info1.lastInsertRowid);
    const v2Id = Number(info2.lastInsertRowid);

    const fromRow = db.prepare(`SELECT * FROM spec_release WHERE id = ?`).get(v1Id);
    const toRow = db.prepare(`SELECT * FROM spec_release WHERE id = ?`).get(v2Id);

    // White-box: exercise the private branch-selection method directly so
    // this test is precise about WHAT declined, independent of whatever the
    // (here, data-free) SQL fallback happens to compute.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gitDelta = await (releaseService as any).tryGitAnchoredDiff(fromRow, toRow);
    expect(gitDelta).toBeNull();
  });

  // M17 defect (brief 0-1-123-to-next.md): when the `pages` root is configured
  // with dir='.' (the builtin default), it scopes the entire project root — so
  // the file-to-root attribution loop must not sweep .claude4spec/briefs,
  // .claude4spec/patches, or other internal .claude4spec/* files into the page
  // diff (ac-korze-tar-bundle-a-zawiera-wy-cznie-ma: briefs/patches are never
  // releasable page content).
  it('excludes .claude4spec/* internal files when the pages root is the project root (dir=".")', async () => {
    // pages root IS the project root — reproduces the offending configuration.
    const { releaseService, releaseStore } = buildReleaseService(dir);

    const info1 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v1', 'v1', 'First', 'user');
    const v1Id = Number(info1.lastInsertRowid);
    releaseStore.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First',
      createdAt: new Date(0).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v1'], dir);

    fs.writeFileSync(path.join(dir, 'real-page.md'), '# Real page');
    fs.mkdirSync(path.join(dir, '.claude4spec/briefs'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude4spec/briefs/some-brief.md'), '# Brief');
    fs.mkdirSync(path.join(dir, '.claude4spec/patches'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude4spec/patches/some-patch.md'), '# Patch');
    fs.writeFileSync(
      path.join(dir, '.claude4spec/config.json'),
      JSON.stringify({ $schemaVersion: 4, name: 'test', git: { enabled: true }, note: 'changed' }, null, 2),
    );
    const info2 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v2', 'v2', 'Second', 'user');
    const v2Id = Number(info2.lastInsertRowid);
    releaseStore.write('v2', {
      name: 'v2',
      slug: 'v2',
      description: 'Second',
      createdAt: new Date(1).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v2'], dir);

    const delta = await releaseService.getReleaseDiff(v1Id, v2Id);

    const paths = delta.pages.map((p) => p.path);
    expect(paths).toContain('real-page.md');
    expect(paths.some((p) => p.startsWith('.claude4spec/'))).toBe(false);
  });

  // code-review fix (0-1-123-to-next): a dot-prefixed subtree can legitimately belong to a
  // MORE SPECIFIC releasable root nested inside a less-specific one (config.ts's dirsOverlap
  // explicitly allows this — the walker never reaches dot-dirs from the outer root, so it's
  // not a hazard). The attribution loop must keep trying other roots instead of dropping the
  // file the moment the first containing root's relPath has a dot segment.
  it('attributes a file to a more specific nested root instead of silently dropping it', async () => {
    const hiddenDir = path.join(dir, '.docs');
    const { releaseService, releaseStore } = buildReleaseServiceMultiRoot(
      ['pages', 'hidden'],
      [dir, hiddenDir],
    );

    const info1 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v1', 'v1', 'First', 'user');
    const v1Id = Number(info1.lastInsertRowid);
    releaseStore.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First',
      createdAt: new Date(0).toISOString(),
      createdBy: 'user',
      roots: ['pages', 'hidden'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v1'], dir);

    fs.mkdirSync(hiddenDir, { recursive: true });
    fs.writeFileSync(path.join(hiddenDir, 'foo.md'), '# Foo');
    const info2 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v2', 'v2', 'Second', 'user');
    const v2Id = Number(info2.lastInsertRowid);
    releaseStore.write('v2', {
      name: 'v2',
      slug: 'v2',
      description: 'Second',
      createdAt: new Date(1).toISOString(),
      createdBy: 'user',
      roots: ['pages', 'hidden'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v2'], dir);

    const delta = await releaseService.getReleaseDiff(v1Id, v2Id);
    const byPath = new Map(delta.pages.map((p) => [p.path, p.op]));
    expect(byPath.get('foo.md')).toBe('created');
    expect(delta.pages.some((p) => p.path.startsWith('.docs/'))).toBe(false);
  });

  // code-review fix (0-1-123-to-next): readConfig() only type-checks briefsDir/patchesDir as
  // strings — an empty string (e.g. a careless hand-edit of config.json) must not resolve
  // briefsAbs/patchesAbs to cwd itself, which would make isInside() match every file and
  // silently empty the whole diff.
  it('does not silently drop every page when briefsDir is an empty string', async () => {
    const pagesDir = path.join(dir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude4spec/config.json'),
      JSON.stringify(
        { $schemaVersion: 4, name: 'test', git: { enabled: true }, briefsDir: '' },
        null,
        2,
      ),
    );
    const { releaseService, releaseStore } = buildReleaseService(pagesDir);

    fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v1');
    const info1 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v1', 'v1', 'First', 'user');
    const v1Id = Number(info1.lastInsertRowid);
    releaseStore.write('v1', {
      name: 'v1',
      slug: 'v1',
      description: 'First',
      createdAt: new Date(0).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v1'], dir);

    fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v2');
    const info2 = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run('v2', 'v2', 'Second', 'user');
    const v2Id = Number(info2.lastInsertRowid);
    releaseStore.write('v2', {
      name: 'v2',
      slug: 'v2',
      description: 'Second',
      createdAt: new Date(1).toISOString(),
      createdBy: 'user',
      roots: ['pages'],
    });
    await git(['add', '.'], dir);
    await git(['commit', '-m', 'v2'], dir);

    const delta = await releaseService.getReleaseDiff(v1Id, v2Id);
    expect(delta.pages.some((p) => p.path === 'a.md' && p.op === 'modified')).toBe(true);
  });

  describe('0.1.124 "reign" model', () => {
    it('an implicit plain `git commit` between two release markers is absorbed into the OLDER release\'s reign, not left out', async () => {
      // This is the behavior that distinguishes the reign model from the old
      // anchor model: snapshot(v2) = M_v3~1 (the commit right before v3's
      // marker), not v2's own marker commit — so a plain terminal `git
      // commit` made after v2 but before v3 counts as part of v2's reign and
      // shows up in a v1..v2 diff.
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      const { releaseService, releaseStore } = buildReleaseService(pagesDir);

      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v1');
      const info1 = db
        .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
        .run('v1', 'v1', 'First', 'user');
      const v1Id = Number(info1.lastInsertRowid);
      releaseStore.write('v1', {
        name: 'v1',
        slug: 'v1',
        description: 'First',
        createdAt: new Date(0).toISOString(),
        createdBy: 'user',
        roots: ['pages'],
      });
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'v1'], dir);

      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v2');
      const info2 = db
        .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
        .run('v2', 'v2', 'Second', 'user');
      const v2Id = Number(info2.lastInsertRowid);
      releaseStore.write('v2', {
        name: 'v2',
        slug: 'v2',
        description: 'Second',
        createdAt: new Date(1).toISOString(),
        createdBy: 'user',
        roots: ['pages'],
      });
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'v2 (its own marker commit)'], dir);

      // Implicit pull: a plain terminal commit, no release created for it —
      // this lands BETWEEN v2's marker and v3's marker.
      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v2.5 (implicit)');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'implicit terminal commit, no release'], dir);

      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v3');
      const info3 = db
        .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
        .run('v3', 'v3', 'Third', 'user');
      releaseStore.write('v3', {
        name: 'v3',
        slug: 'v3',
        description: 'Third',
        createdAt: new Date(2).toISOString(),
        createdBy: 'user',
        roots: ['pages'],
      });
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'v3 (its own marker commit)'], dir);

      const delta = await releaseService.getReleaseDiff(v1Id, v2Id);
      const aChange = delta.pages.find((p) => p.path === 'a.md');
      expect(aChange?.op).toBe('modified');
      const lines = aChange?.modified_sections[0]?.line_diff.lines ?? [];
      // The diff runs all the way to the implicit commit's content, NOT v2's
      // own commit content — proving snapshot(v2) resolved to M_v3~1.
      expect(lines.some((l) => l.op === 'added' && l.content === '# A v2.5 (implicit)')).toBe(true);
      expect(lines.some((l) => l.op === 'added' && l.content === '# A v2')).toBe(false);
    });

    it('the LATEST release\'s reign extends to HEAD, including uncommitted-at-release-time but since-committed changes', async () => {
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      const { releaseService, releaseStore } = buildReleaseService(pagesDir);

      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v1');
      const info1 = db
        .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
        .run('v1', 'v1', 'First', 'user');
      const v1Id = Number(info1.lastInsertRowid);
      releaseStore.write('v1', {
        name: 'v1',
        slug: 'v1',
        description: 'First',
        createdAt: new Date(0).toISOString(),
        createdBy: 'user',
        roots: ['pages'],
      });
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'v1'], dir);

      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v2');
      const info2 = db
        .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
        .run('v2', 'v2', 'Second', 'user');
      const v2Id = Number(info2.lastInsertRowid);
      releaseStore.write('v2', {
        name: 'v2',
        slug: 'v2',
        description: 'Second',
        createdAt: new Date(1).toISOString(),
        createdBy: 'user',
        roots: ['pages'],
      });
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'v2 (its own marker commit)'], dir);

      // v2 IS the latest release — one more implicit commit after it, still
      // counts as part of v2's reign since there is no v3 yet.
      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A latest (post-v2 implicit commit)');
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'implicit terminal commit after latest release'], dir);

      const delta = await releaseService.getReleaseDiff(v1Id, v2Id);
      const aChange = delta.pages.find((p) => p.path === 'a.md');
      const lines = aChange?.modified_sections[0]?.line_diff.lines ?? [];
      expect(lines.some((l) => l.op === 'added' && l.content === '# A latest (post-v2 implicit commit)')).toBe(true);
    });

    it('getUnreleasedDiff git-anchored fast path: `:to=current` picks up UNCOMMITTED working-tree changes since the reign boundary, including a brand-new untracked page', async () => {
      const pagesDir = path.join(dir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      const { releaseService, releaseStore } = buildReleaseService(pagesDir);

      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A v1');
      const info1 = db
        .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
        .run('v1', 'v1', 'First', 'user');
      const v1Id = Number(info1.lastInsertRowid);
      releaseStore.write('v1', {
        name: 'v1',
        slug: 'v1',
        description: 'First',
        createdAt: new Date(0).toISOString(),
        createdBy: 'user',
        roots: ['pages'],
      });
      await git(['add', '.'], dir);
      await git(['commit', '-m', 'v1 (latest — reign extends to HEAD)'], dir);

      // Uncommitted since v1's marker: a.md modified, b.md created and never
      // `git add`ed (must still surface via the untracked-file merge in
      // diffRefToWorkingTree).
      fs.writeFileSync(path.join(pagesDir, 'a.md'), '# A working tree');
      fs.writeFileSync(path.join(pagesDir, 'b.md'), '# B new, untracked');

      const delta = await releaseService.getUnreleasedDiff(v1Id);
      expect(delta.from).toEqual({ id: v1Id, name: 'v1' });
      expect(delta.to).toEqual({ id: 0, name: 'current' });
      const byPath = new Map(delta.pages.map((p) => [p.path, p]));
      expect(byPath.get('a.md')?.op).toBe('modified');
      expect(byPath.get('b.md')?.op).toBe('created');
    });
  });
});

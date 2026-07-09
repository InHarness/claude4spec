import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { ReleaseFileStore } from './release-store.js';
import { ReleasesWatcher } from '../fs/releases-watcher.js';
import { GitService } from './git.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { VersionService } from './versions.js';
import type { PageVersionService } from './page-version.js';
import type { PageSerializer } from './page-serializer.js';
import type { RawEntityReader } from '../domain/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';

const pexec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd });
  return stdout;
}

// Minimal fakes for ReleaseService constructor params the git-anchored branch
// never touches (host/pageSerializer ARE touched by the SQL-fallback path's
// getReleaseSnapshot, so they need just enough shape not to throw).
const fakeHost = { getEntity: () => null } as unknown as PluginHost;
const fakePageSerializer = { version: 'v1' } as unknown as PageSerializer;
const fakeVersions = {} as unknown as VersionService;
const fakePageVersions = {} as unknown as PageVersionService;
const fakeRawReader = {} as unknown as RawEntityReader;
const fakeTagsService = {} as unknown as TagsService;
const fakePagesService = {} as unknown as PagesService;

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
    return { releaseService, releaseStore };
  }

  it('sources from git history when both releases are anchored, producing file-level page changes', async () => {
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
    const byPath = new Map(delta.pages.map((p) => [p.path, p.op]));
    expect(byPath.get('a.md')).toBe('modified');
    expect(byPath.get('b.md')).toBe('created');
    // Degraded fidelity is expected/accepted for the git-anchored path.
    expect(delta.pages.every((p) => p.added_sections.length === 0)).toBe(true);
    expect(delta.entities).toEqual([]);
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
});

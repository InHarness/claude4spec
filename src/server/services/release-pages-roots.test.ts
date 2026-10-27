import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { FileVersionService } from './file-version.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from './file-serializer.js';
import type { VersionService } from './versions.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';

/**
 * 2.1.55 (M17) — a release is snapshot / diff / restore over the version
 * tables only (the bundle is gone). Of the files, only the roots of kind
 * `pages` take part; `file_version` is keyed `(rootId, path)`, so the same
 * relative path under two `pages` roots is two files with two timelines, and
 * rows of the system roots (`briefs`, `plans`, …) never enter a release.
 *
 * Harness: an in-memory DB, two `pages` roots — the base root `pages` (the one
 * restore writes into) and a user root `notes` — and the fakes of
 * `release-root-rename.test.ts`.
 */

const AC = '[ac:ac-release-snapshot-diff-bundle-restore-o]';

const emptyPageDiffFields = {
  added_sections: [] as unknown[],
  removed_sections: [] as unknown[],
  modified_sections: [] as unknown[],
  moved_sections: [] as unknown[],
  frontmatter_diff: null,
  xml_refs_diff: null,
};

/** Where `fakeFileSerializer.snapshot` reads from — the base root's dir. */
let pagesDir = '';

const fakeFileSerializer = {
  version: '1.0.0',
  diff: (a: unknown, b: unknown, p: string, rootId?: string) => {
    const base = { path: p, rootId, ...emptyPageDiffFields };
    if (a == null && b == null) return { ...base, op: 'noop' };
    if (a == null) return { ...base, op: 'created' };
    if (b == null) return { ...base, op: 'deleted' };
    return { ...base, op: JSON.stringify(a) === JSON.stringify(b) ? 'noop' : 'modified' };
  },
  snapshotFromContent: (p: string, content: string) => ({ path: p, content }),
  snapshot: async (p: string) => ({ path: p, content: fs.readFileSync(path.join(pagesDir, p), 'utf8') }),
} as unknown as FileSerializer;

const fakeHost = {
  listEntities: () => [],
  getEntity: () => null,
} as unknown as PluginHost;

describe('M17 release over pages roots only (2.1.55)', () => {
  let db: Database.Database;
  let cwd: string;
  let releases: ReleaseService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-rel-pages-roots-'));
    pagesDir = path.join(cwd, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    const pagesService = {
      rootId: 'pages',
      root: pagesDir,
      records: null,
      exists: async (p: string) => fs.existsSync(path.join(pagesDir, p)),
      remove: async (p: string) => fs.rmSync(path.join(pagesDir, p), { force: true }),
      listMarkdownFiles: async () => fs.readdirSync(pagesDir).filter((f) => f.endsWith('.md')),
    } as unknown as PagesService;
    releases = new ReleaseService(
      db,
      fakeHost,
      {} as unknown as VersionService,
      new FileVersionService(db, fakeFileSerializer),
      fakeFileSerializer,
      {} as unknown as RawEntityReader,
      {} as unknown as TagsService,
      pagesService,
      () => null,
      cwd,
      ['pages', 'notes'],
      [pagesDir, path.join(cwd, 'notes')],
    );
  });

  afterEach(() => {
    db.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function insertFileVersion(rootId: string, p: string, version: number, content: string, op = 'create'): void {
    db.prepare(
      `INSERT INTO file_version (path, version, data, serializer_version, op, changed_by, rootId)
       VALUES (?, ?, ?, '1.0.0', ?, 'user', ?)`,
    ).run(p, version, JSON.stringify({ path: p, content }), op, rootId);
  }

  const releaseIdOf = (rows: Array<{ rootId: string; path: string; release_id: number | null }>, rootId: string, p: string) =>
    rows.find((r) => r.rootId === rootId && r.path === p)?.release_id;

  it(`${AC} a release takes the unreleased rows of every pages root and none of the system roots`, () => {
    insertFileVersion('pages', 'a.md', 1, 'base');
    insertFileVersion('notes', 'a.md', 1, 'note');
    insertFileVersion('briefs', 'a.md', 1, 'brief');
    insertFileVersion('plans', 'p.md', 1, 'plan');

    const r1 = releases.createRelease({ name: 'r1', description: '' }, 'user').id;

    const rows = db.prepare('SELECT rootId, path, release_id FROM file_version').all() as Array<{
      rootId: string;
      path: string;
      release_id: number | null;
    }>;
    expect(releaseIdOf(rows, 'pages', 'a.md')).toBe(r1);
    expect(releaseIdOf(rows, 'notes', 'a.md')).toBe(r1);
    expect(releaseIdOf(rows, 'briefs', 'a.md')).toBeNull();
    expect(releaseIdOf(rows, 'plans', 'p.md')).toBeNull();
  });

  it(`${AC} the snapshot holds the same path once per pages root and nothing from a system root`, () => {
    insertFileVersion('pages', 'a.md', 1, 'base');
    insertFileVersion('notes', 'a.md', 1, 'note');
    insertFileVersion('briefs', 'a.md', 1, 'brief');
    const r1 = releases.createRelease({ name: 'r1', description: '' }, 'user').id;

    const snap = releases.getReleaseSnapshot(r1);
    const contents = snap.pages.map((p) => (p.data as { content: string }).content).sort();
    expect(snap.pages.every((p) => p.path === 'a.md')).toBe(true);
    expect(contents).toEqual(['base', 'note']);
  });

  it(`${AC} the diff pairs a page with its own root's past, never with the same path in another root, and skips system roots`, async () => {
    insertFileVersion('pages', 'a.md', 1, 'base');
    insertFileVersion('notes', 'a.md', 1, 'note');
    const r1 = releases.createRelease({ name: 'r1', description: '' }, 'user').id;
    insertFileVersion('notes', 'a.md', 2, 'note edited', 'update');
    insertFileVersion('briefs', 'b.md', 1, 'brief');
    const r2 = releases.createRelease({ name: 'r2', description: '' }, 'user').id;

    const delta = await releases.getReleaseDiff(r1, r2);
    expect(delta.pages.map((p) => [(p as { rootId?: string }).rootId, p.path, p.op])).toEqual([
      ['notes', 'a.md', 'modified'],
    ]);

    const initial = await releases.getReleaseDiff(null, r1);
    expect(initial.pages.map((p) => [(p as { rootId?: string }).rootId, p.path, p.op]).sort()).toEqual([
      ['notes', 'a.md', 'created'],
      ['pages', 'a.md', 'created'],
    ]);
  });

  it(`${AC} restoring a page reads its own root's version, even when another pages root has a later version of the same path`, async () => {
    insertFileVersion('pages', 'a.md', 1, 'base');
    insertFileVersion('notes', 'a.md', 1, 'note v1');
    insertFileVersion('notes', 'a.md', 2, 'note v2', 'update');
    insertFileVersion('notes', 'a.md', 3, 'note v3', 'update');
    const r1 = releases.createRelease({ name: 'r1', description: '' }, 'user').id;
    fs.writeFileSync(path.join(pagesDir, 'a.md'), 'edited since');

    const result = await releases.restorePage({ path: 'a.md', releaseId: r1 });

    expect(result.op).toBe('updated');
    expect(fs.readFileSync(path.join(pagesDir, 'a.md'), 'utf8')).toBe('base');
  });

  it(`${AC} restoring the spec brings back the base root's pages only — a path released under another pages root is not written here`, async () => {
    insertFileVersion('pages', 'a.md', 1, 'base');
    insertFileVersion('notes', 'n.md', 1, 'note only');
    const r1 = releases.createRelease({ name: 'r1', description: '' }, 'user').id;
    // A later release in which nothing changed: restore of r2 still sees r1's pages.
    const r2 = releases.createRelease({ name: 'r2', description: '' }, 'user').id;

    const result = await releases.restoreSpec({ releaseId: r2 });

    expect(result.pageResults.map((p) => [p.path, p.op])).toEqual([['a.md', 'created']]);
    expect(fs.readFileSync(path.join(pagesDir, 'a.md'), 'utf8')).toBe('base');
    expect(fs.existsSync(path.join(pagesDir, 'n.md'))).toBe(false);
  });
});

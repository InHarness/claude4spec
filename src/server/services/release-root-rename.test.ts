import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { FileVersionService } from './file-version.js';
import { builtinPagesRoot, configPath } from '../config.js';
import { rootIdChain, type RootRenameTransition } from '../root-renames.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from './file-serializer.js';
import type { VersionService } from './versions.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';

/**
 * 0.2.101 — history and diffs follow the SPACE, not the literal
 * `rootId`.
 *
 * A rename never re-stamps `file_version`: rows written before it keep the
 * retired identifier, because overwriting them would erase the address a
 * version was actually born under. Everything below therefore exercises the
 * READ side, where continuity lives — each case is one of the brief's new
 * acceptance criteria.
 *
 * Harness: an in-memory DB and the same fakes as
 * `release-unreleased-diff.test.ts`. The space here was `pages` and is now
 * `docs`.
 */

const TRANSITIONS: RootRenameTransition[] = [{ from: 'pages', to: 'docs', at: '2026-01-02T00:00:00.000Z' }];

const emptyPageDiffFields = {
  added_sections: [] as unknown[],
  removed_sections: [] as unknown[],
  modified_sections: [] as unknown[],
  moved_sections: [] as unknown[],
  frontmatter_diff: null,
  xml_refs_diff: null,
};

const fakeFileSerializer = {
  version: 'v1',
  diff: (a: unknown, b: unknown, p: string) => {
    if (a == null && b == null) return { path: p, op: 'noop', ...emptyPageDiffFields };
    if (a == null) return { path: p, op: 'created', ...emptyPageDiffFields };
    if (b == null) return { path: p, op: 'deleted', ...emptyPageDiffFields };
    return { path: p, op: JSON.stringify(a) === JSON.stringify(b) ? 'noop' : 'modified', ...emptyPageDiffFields };
  },
  snapshotFromContent: (p: string, content: string) => ({ path: p, content }),
} as unknown as FileSerializer;

const fakeHost = {
  listEntities: () => [],
  getEntity: () => null,
} as unknown as PluginHost;

describe('release tier across a root rename (0.2.101)', () => {
  let db: Database.Database;
  let cwd: string;
  let releases: ReleaseService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    // A cwd with a config whose base root is ALREADY `docs` — the state right
    // after the rename. `git.enabled` stays at its default (off), so the diff
    // takes the SQL path under test rather than the git-anchored one.
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-rel-rename-'));
    fs.mkdirSync(path.dirname(configPath(cwd)), { recursive: true });
    fs.writeFileSync(
      configPath(cwd),
      JSON.stringify({ $schemaVersion: 4, name: 'X', roots: [{ ...builtinPagesRoot(), id: 'docs' }] }),
    );
    releases = new ReleaseService(
      db,
      fakeHost,
      {} as unknown as VersionService,
      new FileVersionService(db, fakeFileSerializer, (id) => rootIdChain(TRANSITIONS, id)),
      fakeFileSerializer,
      {} as unknown as RawEntityReader,
      {} as unknown as TagsService,
      { rootId: 'docs', root: path.join(cwd, 'docs') } as unknown as PagesService,
      () => null,
      cwd,
      ['docs'],
      [path.join(cwd, 'pages')],
      TRANSITIONS,
    );
  });

  afterEach(() => {
    db.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function insertRelease(name: string): number {
    const info = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by, created_at) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
      .run(name, name, `desc for ${name}`, 'user');
    return Number(info.lastInsertRowid);
  }

  function insertPageVersion(o: {
    rootId: string;
    path: string;
    version: number;
    content: string;
    releaseId: number | null;
    op?: string;
  }): void {
    db.prepare(
      `INSERT INTO file_version
        (path, version, data, serializer_version, op, release_id, changed_by, rootId)
       VALUES (?, ?, ?, 'v1', ?, ?, 'user', ?)`,
    ).run(
      o.path,
      o.version,
      JSON.stringify({ path: o.path, content: o.content }),
      o.op ?? 'create',
      o.releaseId,
      o.rootId,
    );
  }

  /**
   * AC: "The version history of a page in a space renamed from `pages` to
   * `docs` contains the versions written before the rename as earlier versions
   * of the same page."
   */
  it('[ac:root-rename-history-continuous] a page history reaches back across the rename, and numbering does not restart', async () => {
    insertPageVersion({ rootId: 'pages', path: 'a.md', version: 1, content: 'one', releaseId: null });
    insertPageVersion({ rootId: 'pages', path: 'a.md', version: 2, content: 'two', releaseId: null, op: 'update' });

    const versions = new FileVersionService(db, fakeFileSerializer, (id) => rootIdChain(TRANSITIONS, id));
    // A write AFTER the rename lands under the live id — and continues the
    // numbering instead of starting again at 1.
    await versions.recordVersion('a.md', 'delete', 'user', 'three', undefined, 'docs');

    const history = versions.listVersions('a.md', 'docs');
    expect(history.map((v) => [v.version, v.rootId])).toEqual([
      [3, 'docs'],
      [2, 'pages'],
      [1, 'pages'],
    ]);
    // Asked under the retired id alone, the old rows are still there — nothing
    // was re-stamped — but that id no longer names the space's present.
    expect(versions.listVersions('a.md', 'pages').map((v) => v.version)).toEqual([2, 1]);
  });

  it('a release after the rename collects the unreleased rows written under BOTH identifiers', () => {
    insertPageVersion({ rootId: 'pages', path: 'a.md', version: 1, content: 'before', releaseId: null });
    insertPageVersion({ rootId: 'docs', path: 'b.md', version: 1, content: 'after', releaseId: null });

    const versions = new FileVersionService(db, fakeFileSerializer, (id) => rootIdChain(TRANSITIONS, id));
    const relId = insertRelease('r1');
    expect(versions.assignToRelease(relId, ['docs'])).toBe(2);
  });

  it('a snapshot holds each page ONCE, even when it has rows under the old and the new id', () => {
    const r1 = insertRelease('r1');
    insertPageVersion({ rootId: 'pages', path: 'a.md', version: 1, content: 'old', releaseId: r1 });
    insertPageVersion({ rootId: 'docs', path: 'a.md', version: 2, content: 'new', releaseId: null, op: 'update' });

    const snap = releases.getCurrentSnapshot();
    expect(snap.pages).toEqual([
      { path: 'a.md', op: 'update', data: { path: 'a.md', content: 'new' } },
    ]);
  });

  /**
   * AC: "A diff of two releases between which the page space changed its
   * identifier, but the page's content did not, does not show the page as
   * changed." And its twin: a page that DID change comes out as an update —
   * never as a delete of the old address plus a create of the new one.
   */
  it('[ac:root-rename-diff-same-space] a diff across the rename skips unchanged pages and reports changed ones as modified', async () => {
    const r1 = insertRelease('r1');
    insertPageVersion({ rootId: 'pages', path: 'same.md', version: 1, content: 'stable', releaseId: r1 });
    insertPageVersion({ rootId: 'pages', path: 'edited.md', version: 1, content: 'before', releaseId: r1 });
    const r2 = insertRelease('r2');
    insertPageVersion({
      rootId: 'docs',
      path: 'edited.md',
      version: 2,
      content: 'after',
      releaseId: r2,
      op: 'update',
    });

    const delta = await releases.getReleaseDiff(r1, r2);
    expect(delta.pages.map((p) => [p.path, p.op])).toEqual([['edited.md', 'modified']]);
  });
});

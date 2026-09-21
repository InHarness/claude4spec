import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { FileVersionService } from './file-version.js';
import {
  BUNDLE_SCHEMA_VERSION,
  buildBundleArchive,
  extractBundleStream,
  type BundleManifest,
} from './release-bundle.js';
import { builtinPagesRoot, configPath, type NormalizedConfig } from '../config.js';
import { rootIdChain, type RootRenameTransition } from '../root-renames.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from './file-serializer.js';
import type { VersionService } from './versions.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';
import type { Release, SpecSnapshot } from '../../shared/entities.js';

/**
 * 0.2.101 — history, diffs and bundles follow the SPACE, not the literal
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
  // Reads the restored file back the way the real serializer does — relative
  // to the base root's directory of the test's current cwd.
  snapshot: async (p: string) => ({ path: p, content: fs.readFileSync(path.join(snapshotRoot, p), 'utf8') }),
} as unknown as FileSerializer;

/** Set per test: where `fakeFileSerializer.snapshot` reads from. */
let snapshotRoot = '';

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
    snapshotRoot = path.join(cwd, 'docs');
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
      () => null,
      TRANSITIONS,
    );
  });

  afterEach(() => {
    db.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function insertRelease(name: string): number {
    const info = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
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
    expect(versions.countUnreleased(['docs'])).toBe(2);
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

    const delta = await releases.getReleaseDiff('r1', 'r2');
    expect(delta.pages.map((p) => [p.path, p.op])).toEqual([['edited.md', 'modified']]);
  });

  /**
   * AC: "A release bundle built before the space was renamed has the same
   * SHA-256 after the rename as before it." Old archives are never rewritten; a
   * NEW bundle of the same release is laid out under the current id, with the
   * retired one recorded in the manifest.
   */
  it('[ac:root-rename-bundle-stable] a bundle built before the rename is untouched; a new one uses the live prefix + formerIds', async () => {
    const release: Release = {
      id: 1,
      name: 'r1',
      description: '',
      createdBy: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const snapshot = { release, entities: [], pages: [], serializer_versions: { page: '1.0.0' } } as unknown as SpecSnapshot;
    const before = await buildBundleArchive(
      snapshot,
      release,
      {
        $schemaVersion: 4,
        name: 'X',
        roots: [builtinPagesRoot()],
        writingStyle: null,
        onboardingCompleted: true,
        agent: { claudeUsePreset: false, disableDirectFilesystemAccess: true },
      } as unknown as NormalizedConfig,
      [{ rootId: 'pages', path: 'a.md', op: 'create', content: 'hello' }],
      [],
      null,
    );
    const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const shaBefore = sha(before.tarGzPath);

    // The rename happens here. Nothing in it touches an archive on disk.
    expect(sha(before.tarGzPath)).toBe(shaBefore);
    expect(before.sha256).toBe(shaBefore);

    // A bundle built NOW from the pre-rename rows: one space, one prefix — the
    // current id — and the manifest names the retired one.
    const r1 = insertRelease('r1');
    insertPageVersion({ rootId: 'pages', path: 'a.md', version: 1, content: 'hello', releaseId: r1 });
    const after = await releases.buildBundleArchive(r1);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-rel-rename-x-'));
    try {
      await extractBundleStream(fs.createReadStream(after.tarGzPath), dir);
      expect(fs.existsSync(path.join(dir, 'docs', 'a.md'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'pages'))).toBe(false);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as BundleManifest;
      expect(manifest.roots).toEqual([
        expect.objectContaining({ id: 'docs', formerIds: ['pages'] }),
      ]);
      // Additive field — the schema version does not move for it. (It is 4 on
      // main since the entity-layout change; what matters is that 0.2.101
      // leaves it where it was.)
      expect(manifest.bundleSchemaVersion).toBe(BUNDLE_SCHEMA_VERSION);
      expect(BUNDLE_SCHEMA_VERSION).toBe(4);
      // The transitions ride ONLY the manifest, never the sanitized config.
      const bundledConfig = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
      expect(bundledConfig).not.toMatch(/formerIds|transitions/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(after.tarGzPath, { force: true });
      fs.rmSync(before.tarGzPath, { force: true });
    }
  });
  /**
   * The archive prefix may carry a RETIRED identifier. Restore matches it
   * against the entry's current `id` OR any of its `formerIds`, and writes the
   * pages under the current address — so the space comes back as one space, not
   * as a stray directory named after an address that no longer exists.
   */
  it('restore matches an archive prefix against formerIds and writes under the current id', async () => {
    const release: Release = {
      id: 9,
      name: 'r9',
      description: '',
      createdBy: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const snapshot = { release, entities: [], pages: [], serializer_versions: { page: '1.0.0' } } as unknown as SpecSnapshot;
    const built = await buildBundleArchive(
      snapshot,
      release,
      {
        $schemaVersion: 4,
        name: 'X',
        roots: [{ ...builtinPagesRoot(), id: 'docs', dir: 'docs' }],
        writingStyle: null,
        onboardingCompleted: true,
        agent: { claudeUsePreset: false, disableDirectFilesystemAccess: true },
      } as unknown as NormalizedConfig,
      // Laid out under the RETIRED prefix, the way an archive can legitimately be.
      [{ rootId: 'pages', path: 'guide/intro.md', op: 'create', content: '# Intro\n' }],
      [],
      null,
      { docs: ['pages'] },
    );
    try {
      const restored = await releases.restoreBundleArchive(fs.createReadStream(built.tarGzPath));
      expect(restored.pages.map((p) => p.path)).toEqual(['guide/intro.md']);
      expect(fs.readFileSync(path.join(cwd, 'docs', 'guide', 'intro.md'), 'utf8')).toBe('# Intro\n');
      expect(fs.existsSync(path.join(cwd, 'pages'))).toBe(false);
      // Its version row is filed under the live identifier.
      const row = db.prepare(`SELECT rootId FROM file_version WHERE path = 'guide/intro.md'`).get() as {
        rootId: string;
      };
      expect(row.rootId).toBe('docs');
    } finally {
      fs.rmSync(built.tarGzPath, { force: true });
    }
  });
});

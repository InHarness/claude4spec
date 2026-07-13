import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { defaultDeepDiff } from '../serialization/snapshot.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { PageSerializer } from './page-serializer.js';
import type { VersionService } from './versions.js';
import type { PageVersionService } from './page-version.js';
import type { RawEntityReader } from '../domain/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';

// 0.1.122: `getCurrentSnapshot`/`getUnreleasedDiff` never touch git-anchoring,
// readConfig, or the on-disk release store — an in-memory DB + these fakes is
// enough. `host.diff` delegates to the real `defaultDeepDiff` so entity `op`
// values match production semantics instead of being hand-rolled per test.
const fakeHost = {
  getEntity: (type: string) => (type === 'endpoint' ? { serializer: { version: 'v1' } } : null),
  diff: (type: string, a: unknown, b: unknown, slug: string) => defaultDeepDiff(type, slug, a, b),
} as unknown as PluginHost;

const emptyPageDiffFields = {
  added_sections: [] as unknown[],
  removed_sections: [] as unknown[],
  modified_sections: [] as unknown[],
  moved_sections: [] as unknown[],
  frontmatter_diff: null,
  xml_refs_diff: null,
};

const fakePageSerializer = {
  version: 'v1',
  diff: (a: unknown, b: unknown, path: string) => {
    if (a == null && b == null) return { path, op: 'noop', ...emptyPageDiffFields };
    if (a == null) return { path, op: 'created', ...emptyPageDiffFields };
    if (b == null) return { path, op: 'deleted', ...emptyPageDiffFields };
    return { path, op: JSON.stringify(a) === JSON.stringify(b) ? 'noop' : 'modified', ...emptyPageDiffFields };
  },
} as unknown as PageSerializer;

const fakeVersions = {} as unknown as VersionService;
const fakePageVersions = {
  assignToRelease: () => {},
} as unknown as PageVersionService;
const fakeRawReader = {} as unknown as RawEntityReader;
const fakeTagsService = {} as unknown as TagsService;
const fakePagesService = {} as unknown as PagesService;

describe('ReleaseService — compare-with-current-state (0.1.122)', () => {
  let db: Database.Database;
  let releases: ReleaseService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    releases = new ReleaseService(
      db,
      fakeHost,
      fakeVersions,
      fakePageVersions,
      fakePageSerializer,
      fakeRawReader,
      fakeTagsService,
      fakePagesService,
    );
  });

  afterEach(() => {
    db.close();
  });

  function insertRelease(name: string): number {
    const info = db
      .prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
      .run(name, name, `desc for ${name}`, 'user');
    return Number(info.lastInsertRowid);
  }

  function insertEntityVersion(opts: {
    slug: string;
    version: number;
    data: unknown;
    releaseId: number | null;
    op?: string;
  }): void {
    db.prepare(
      `INSERT INTO entity_version
        (entity_type, entity_slug, version, data, changed_by, release_id, serializer_version, op)
       VALUES ('endpoint', ?, ?, ?, 'user', ?, 'v1', ?)`,
    ).run(opts.slug, opts.version, JSON.stringify(opts.data), opts.releaseId, opts.op ?? 'create');
  }

  function insertPageVersion(opts: {
    path: string;
    version: number;
    data: unknown;
    releaseId: number | null;
    op?: string;
  }): void {
    db.prepare(
      `INSERT INTO page_version
        (path, version, data, serializer_version, op, release_id, changed_by, rootId)
       VALUES (?, ?, ?, 'v1', ?, ?, 'user', 'pages')`,
    ).run(opts.path, opts.version, JSON.stringify(opts.data), opts.op ?? 'create', opts.releaseId);
  }

  describe('getCurrentSnapshot', () => {
    it('includes release_id IS NULL rows when they are the latest version for their slug/path', () => {
      const relId = insertRelease('v1');
      insertEntityVersion({ slug: 'e1', version: 1, data: { title: 'released' }, releaseId: relId });
      insertEntityVersion({ slug: 'e1', version: 2, data: { title: 'unreleased' }, releaseId: null, op: 'update' });
      insertPageVersion({ path: 'a.md', version: 1, data: { content: 'released' }, releaseId: relId });
      insertPageVersion({ path: 'a.md', version: 2, data: { content: 'unreleased' }, releaseId: null, op: 'update' });

      const snap = releases.getCurrentSnapshot();

      expect(snap.entities).toEqual([
        { type: 'endpoint', slug: 'e1', op: 'update', data: { title: 'unreleased' } },
      ]);
      expect(snap.pages).toEqual([
        { path: 'a.md', op: 'update', data: { content: 'unreleased' } },
      ]);
    });

    it('has no upper bound on release_id — later releases are visible too', () => {
      const rel1 = insertRelease('v1');
      const rel2 = insertRelease('v2');
      insertEntityVersion({ slug: 'e1', version: 1, data: { title: 'v1 state' }, releaseId: rel1 });
      insertEntityVersion({ slug: 'e1', version: 2, data: { title: 'v2 state' }, releaseId: rel2, op: 'update' });

      const snap = releases.getCurrentSnapshot();

      expect(snap.entities).toEqual([
        { type: 'endpoint', slug: 'e1', op: 'update', data: { title: 'v2 state' } },
      ]);
    });
  });

  describe('getUnreleasedDiff', () => {
    it('diffs a release against the live unreleased state, from = the release meta, to = current', async () => {
      const relId = insertRelease('v1');
      insertEntityVersion({ slug: 'e1', version: 1, data: { title: 'released' }, releaseId: relId });
      insertEntityVersion({ slug: 'e1', version: 2, data: { title: 'unreleased edit' }, releaseId: null, op: 'update' });
      insertPageVersion({ path: 'a.md', version: 1, data: { content: 'released' }, releaseId: relId });
      insertPageVersion({ path: 'b.md', version: 1, data: { content: 'new unreleased page' }, releaseId: null });

      const delta = await releases.getUnreleasedDiff('v1');

      expect(delta.from).toEqual({ id: relId, name: 'v1' });
      expect(delta.to).toEqual({ id: 0, name: 'current' });
      expect(delta.entities).toEqual([
        expect.objectContaining({ type: 'endpoint', slug: 'e1', op: 'modified' }),
      ]);
      const pageOps = new Map(delta.pages.map((p) => [p.path, p.op]));
      expect(pageOps.get('b.md')).toBe('created');
      expect(pageOps.has('a.md')).toBe(false); // unchanged since the release ⇒ noop, filtered out
    });

    it('returns an empty delta when the release already matches the current state', async () => {
      const relId = insertRelease('v1');
      insertEntityVersion({ slug: 'e1', version: 1, data: { title: 'stable' }, releaseId: relId });

      const delta = await releases.getUnreleasedDiff('v1');

      expect(delta.entities).toEqual([]);
      expect(delta.pages).toEqual([]);
    });

    it('from = null diffs the initial/empty state against current (every row appears as created)', async () => {
      insertEntityVersion({ slug: 'e1', version: 1, data: { title: 'only unreleased state' }, releaseId: null });

      const delta = await releases.getUnreleasedDiff(null);

      expect(delta.from).toBeNull();
      expect(delta.to).toEqual({ id: 0, name: 'current' });
      expect(delta.entities).toEqual([
        expect.objectContaining({ type: 'endpoint', slug: 'e1', op: 'created' }),
      ]);
    });

    it('throws NOT_FOUND for an unresolvable `from` release', async () => {
      await expect(releases.getUnreleasedDiff('does-not-exist')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('reserved release name', () => {
    it('createRelease rejects the name "current" with RELEASE_NAME_RESERVED', () => {
      expect(() => releases.createRelease({ name: 'current', description: 'x' }, 'user')).toThrow(
        expect.objectContaining({ code: 'RELEASE_NAME_RESERVED' }),
      );
    });

    it('updateRelease rejects renaming the latest release to "current"', async () => {
      releases.createRelease({ name: 'v1', description: 'first' }, 'user');
      await expect(releases.updateRelease({ idOrName: 'v1', name: 'current' })).rejects.toMatchObject({
        code: 'RELEASE_NAME_RESERVED',
      });
    });

    it('still rejects an empty name before checking the reserved name (unchanged precedence)', () => {
      expect(() => releases.createRelease({ name: '', description: 'x' }, 'user')).toThrow(
        expect.objectContaining({ code: 'VALIDATION' }),
      );
    });

    it('updateRelease resubmitting an unchanged legacy "current" name does not throw (0.1.122 code-review fix)', async () => {
      // createRelease now blocks new 'current' releases, but legacy/pre-
      // migration data (or a release-identity file synced before the indexer
      // guard existed) could already hold that name — insert directly to
      // simulate it, bypassing createRelease's validation.
      db.prepare(`INSERT INTO spec_release (name, slug, description, created_by) VALUES (?, ?, ?, ?)`)
        .run('current', 'current', 'legacy', 'user');

      const updated = await releases.updateRelease({ idOrName: 'current', name: 'current', description: 'new desc' });
      expect(updated.description).toBe('new desc');
    });

    it('updateRelease still rejects an ACTUAL rename to "current"', async () => {
      releases.createRelease({ name: 'v1', description: 'first' }, 'user');
      await expect(
        releases.updateRelease({ idOrName: 'v1', name: 'current', description: 'x' }),
      ).rejects.toMatchObject({ code: 'RELEASE_NAME_RESERVED' });
    });
  });
});

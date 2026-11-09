/**
 * 2.1.77 (M17 L19 `tutwwt5x`) — the release axis in a project of type `skill`,
 * which lacks the capability `entities`. The project context wires the
 * capability into the release service (`setEntitiesCapability`), as it reads it
 * from the project's type. The fixtures DO hold `entity_version` rows: the
 * branch is taken by the capability, not by the accident of an empty table.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { runMigrations } from '../db/migrate.js';
import { ReleaseService } from './release.js';
import { FileVersionService } from './file-version.js';
import { diffEntity } from '../serialization/snapshot.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { FileSerializer } from './file-serializer.js';
import type { VersionService } from './versions.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { TagsService } from './tags.js';
import type { PagesService } from './pages.js';
import { releasesRouter } from '../routes/releases.js';
import { errorHandler } from '../routes/errors.js';
import { unreleasedCountOf } from '../../shared/unreleased-counter.js';
import { hostProjectTypeRegistry } from '../project-types/registry.js';

const endpointModule = {
  type: 'endpoint',
  payloadVersion: 1,
  data: { schema: { slug: { type: 'string' }, title: { type: 'string' } } },
};
// A host that still enumerates a type — the capability, not the host, decides.
const fakeHost = {
  listEntities: () => [endpointModule],
  getEntity: (type: string) => (type === 'endpoint' ? endpointModule : null),
  diff: (type: string, a: unknown, b: unknown) => diffEntity(fakeHost, type, a, b),
} as unknown as PluginHost;

const noopDiff = { added_sections: [], removed_sections: [], modified_sections: [], moved_sections: [], frontmatter_diff: null, xml_refs_diff: null };
const fakeFileSerializer = {
  version: 'v1',
  diff: (a: unknown, b: unknown, path: string, rootId: string) => {
    if (a == null && b == null) return { rootId, path, op: 'noop', ...noopDiff };
    if (a == null) return { rootId, path, op: 'created', ...noopDiff };
    if (b == null) return { rootId, path, op: 'deleted', ...noopDiff };
    return { rootId, path, op: JSON.stringify(a) === JSON.stringify(b) ? 'noop' : 'modified', ...noopDiff };
  },
} as unknown as FileSerializer;

const skillHasEntities = () => hostProjectTypeRegistry().get('skill')!.capabilities.includes('entities');

describe('releases in a project of type `skill` — pages only (2.1.77, M17 `tutwwt5x`)', () => {
  let db: Database.Database;
  let releases: ReleaseService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    releases = new ReleaseService(
      db,
      fakeHost,
      {} as unknown as VersionService,
      new FileVersionService(db, fakeFileSerializer),
      fakeFileSerializer,
      { listSlugs: () => ['e1'] } as unknown as RawEntityReader,
      {} as unknown as TagsService,
      { rootId: 'pages', listMarkdownFiles: async () => ['a.md'] } as unknown as PagesService,
      () => null,
      process.cwd(),
      ['pages'],
    );
    // What the project context does for a `skill` project.
    releases.setEntitiesCapability(skillHasEntities());
  });
  afterEach(() => db.close());

  function insertEntityVersion(slug: string, version: number, title: string, releaseId: number | null, op = 'create') {
    db.prepare(
      `INSERT INTO entity_version (entity_type, entity_slug, version, data, changed_by, release_id, serializer_version, op)
       VALUES ('endpoint', ?, ?, ?, 'user', ?, 'v1', ?)`,
    ).run(slug, version, JSON.stringify({ slug, title }), releaseId, op);
  }
  function insertPageVersion(path: string, version: number, content: string, releaseId: number | null, op = 'create') {
    db.prepare(
      `INSERT INTO file_version (path, version, data, serializer_version, op, release_id, changed_by, rootId)
       VALUES (?, ?, ?, 'v1', ?, ?, 'user', 'pages')`,
    ).run(path, version, JSON.stringify({ content }), op, releaseId);
  }

  it('the type `skill` has no `entities` capability — the premise', () => {
    expect(skillHasEntities()).toBe(false);
  });

  it('[ac:ac-w-projekcie-typu-skill-zwrot-utworzen] in a `skill` project the release-create return carries an empty per-entity-type breakdown', () => {
    insertEntityVersion('e1', 1, 'unreleased', null);
    insertPageVersion('a.md', 1, 'page', null);

    const rel = releases.createRelease({ name: 'v1', description: '' }, 'user');

    expect(rel.countBreakdown.entities).toEqual({});
    // The page total is there; the total counts pages only.
    expect(rel.countBreakdown.pages).toBe(1);
    expect(rel.countBreakdown.total).toBe(1);
    // The release assigned itself no entity version.
    const assigned = db.prepare(`SELECT COUNT(*) AS n FROM entity_version WHERE release_id IS NOT NULL`).get() as { n: number };
    expect(assigned.n).toBe(0);
  });

  it('[ac:ac-w-projekcie-typu-skill-delta-release] in a `skill` project the release_diff delta between two releases has no entity position', async () => {
    const v1 = Number(db.prepare(`INSERT INTO spec_release (name, slug, description, created_by, created_at) VALUES ('v1','v1','','user','2026-01-01T00:00:00.000Z')`).run().lastInsertRowid);
    const v2 = Number(db.prepare(`INSERT INTO spec_release (name, slug, description, created_by, created_at) VALUES ('v2','v2','','user','2026-01-02T00:00:00.000Z')`).run().lastInsertRowid);
    insertEntityVersion('e1', 1, 'in v1', v1);
    insertEntityVersion('e1', 2, 'in v2', v2, 'update');
    insertEntityVersion('e2', 1, 'new in v2', v2);
    insertPageVersion('a.md', 1, 'in v1', v1);
    insertPageVersion('a.md', 2, 'in v2', v2, 'update');

    const delta = await releases.getReleaseDiff(v1, v2);
    expect(delta.entities).toEqual([]);
    // The page dimension works unchanged.
    expect(delta.pages.map((p) => p.path)).toEqual(['a.md']);

    // The same through the route the channels render.
    const app = express().use(express.json()).use('/api/releases', releasesRouter(releases)).use(errorHandler);
    const res = await request(app).get('/api/releases/v1/diff/v2?view=operation');
    expect(res.status).toBe(200);
    expect(res.body.data.entities ?? []).toEqual([]);
    expect(res.body.data.total?.entities ?? 0).toBe(0);
  });

  it('[ac:ac-w-projekcie-typu-skill-licznik-niezre] in a `skill` project the unreleased counter equals the number of changed pages', async () => {
    const v1 = Number(db.prepare(`INSERT INTO spec_release (name, slug, description, created_by, created_at) VALUES ('v1','v1','','user','2026-01-01T00:00:00.000Z')`).run().lastInsertRowid);
    insertPageVersion('a.md', 1, 'released', v1);
    insertPageVersion('a.md', 2, 'edited', null, 'update');
    insertPageVersion('b.md', 1, 'new', null);
    // Unreleased entity versions, which a project with `entities` would count.
    insertEntityVersion('e1', 1, 'unreleased', null);
    insertEntityVersion('e2', 1, 'unreleased', null);

    // The counter: the light delta newest release → current, summed by the shared function.
    const app = express().use(express.json()).use('/api/releases', releasesRouter(releases)).use(errorHandler);
    const res = await request(app).get('/api/releases/v1/diff/current?view=operation&summaryOnly=true');
    expect(res.status).toBe(200);
    expect(unreleasedCountOf(res.body.data.total)).toBe(2);
    expect(res.body.data.entities ?? []).toEqual([]);
  });

  it('[ac:ac-w-projekcie-typu-skill-przywrocenie-c] in a `skill` project restoring the whole specification to a release adds only page versions to the history', async () => {
    const v1 = Number(db.prepare(`INSERT INTO spec_release (name, slug, description, created_by, created_at) VALUES ('v1','v1','','user','2026-01-01T00:00:00.000Z')`).run().lastInsertRowid);
    insertEntityVersion('e1', 1, 'in v1', v1);
    insertPageVersion('a.md', 1, 'in v1', v1);
    const restoreEntity = vi.spyOn(releases, 'restoreEntity');
    const restorePage = vi
      .spyOn(releases, 'restorePage')
      .mockImplementation(async ({ path }) => ({ path, op: 'update', warnings: [] }) as never);
    const entityRowsBefore = (db.prepare(`SELECT COUNT(*) AS n FROM entity_version`).get() as { n: number }).n;

    const result = await releases.restoreSpec({ releaseId: v1 });

    // The `restorePage` loop alone: no topological sort, no `restoreEntity`.
    expect(restoreEntity).not.toHaveBeenCalled();
    expect(result.entityResults).toEqual([]);
    expect(restorePage).toHaveBeenCalledWith(expect.objectContaining({ path: 'a.md', releaseId: v1 }), 'user');
    expect(result.pageResults.map((p) => p.path)).toEqual(['a.md']);
    // No entity version was added to the history.
    expect((db.prepare(`SELECT COUNT(*) AS n FROM entity_version`).get() as { n: number }).n).toBe(entityRowsBefore);
  });
});

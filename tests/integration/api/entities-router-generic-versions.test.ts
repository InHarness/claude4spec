import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { ENTITY_VERSIONS_ROUTE } from '../../../src/server/core/plugin-host/entities-router.js';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { fixtureModule } from '../../helpers/fixture-module.js';

describe('GET /api/entities/:type/:slug/versions — generic for a plugin-contributed type (M17)', () => {
  const type = 'widget';
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp({ extraModules: [fixtureModule(type, { withEntityService: true })] });
    t.db.prepare(`INSERT INTO ${type} (slug, title) VALUES ('my-widget', 'Hello')`).run();
  });
  afterEach(() => t.cleanup());

  it('returns entity_version rows for a type outside the core RawEntityType union', async () => {
    t.versionService.captureEntitySnapshot(type, 'my-widget', 'create', 'user', 'Created', '1.0.0');

    const res = await request(t.app).get(`/api/entities/${type}/my-widget/versions`);

    expect(res.status).toBe(200);
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.versions[0]).toMatchObject({ version: 1, op: 'create' });
  });

  it('returns an empty list (not an error) before anything has been captured', async () => {
    const res = await request(t.app).get(`/api/entities/${type}/my-widget/versions`);

    expect(res.status).toBe(200);
    expect(res.body.versions).toEqual([]);
  });

  it('still 404s for an unknown slug of the plugin type, same as a core type', async () => {
    const res = await request(t.app).get(`/api/entities/${type}/does-not-exist/versions`);
    expect(res.status).toBe(404);
  });
});

/**
 * 0.2.9 (item 13) — what a REAL create records, through a real per-type service.
 *
 * The unit tests all called `captureEntitySnapshot` themselves, so making the
 * version argument optional and resolving it inside `VersionService` looked
 * complete while every one of the eighteen service call sites kept passing its
 * own semver literal. An AC created through the route still recorded `'1.0.0'`;
 * the only thing that noticed was a live smoke test. This asserts the column
 * from the far end of the write path, where the drift was actually visible.
 */
describe('entity_version.serializer_version — written by a per-type service (0.2.9 item 13)', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('records the type\'s integer payloadVersion, not a serializer semver', async () => {
    const created = await request(t.app).post('/api/acs').send({ title: 'version capture' });
    expect(created.status).toBe(201);

    const row = t.db
      .prepare(`SELECT serializer_version FROM entity_version WHERE entity_type = 'ac' AND entity_slug = ?`)
      .get(created.body.data.slug) as { serializer_version: string };
    // `ac` moved to payload 2 in 0.2.22, when it gained the reserved `title`,
    // and to 3 in 0.2.51, when `text` and `description` collapsed back into it.
    expect(row.serializer_version).toBe('3');
  });
});

/**
 * 2.1.25 (M17 `m17api401`) — every row of the version list carries `releaseId`:
 * the release the version belongs to, `null` for a change not yet released.
 * Version 1 is captured and assigned to a release; version 2 is captured after
 * it and stays unreleased.
 */
describe('GET /api/entities/:type/:slug/versions — EntityVersionMeta rows with releaseId (2.1.25)', () => {
  const type = 'widget';
  let t: TestApp;
  let releaseId: number;

  beforeEach(async () => {
    t = await createTestApp({ extraModules: [fixtureModule(type, { withEntityService: true })] });
    t.db.prepare(`INSERT INTO ${type} (slug, title) VALUES ('my-widget', 'Hello')`).run();
    t.versionService.captureEntitySnapshot(type, 'my-widget', 'create', 'user', 'Created', '1.0.0');
    releaseId = Number(
      t.db
        .prepare(`INSERT INTO spec_release (name, slug, description, created_by, created_at) VALUES (?,?,?,?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
        .run('r1', 'r1', 'first', 'user').lastInsertRowid,
    );
    t.db.prepare(`UPDATE entity_version SET release_id = ? WHERE release_id IS NULL`).run(releaseId);
    // A real content change, so the `update` capture is not deduplicated away.
    t.db.prepare(`UPDATE ${type} SET title = 'Hello again' WHERE slug = 'my-widget'`).run();
    t.versionService.captureEntitySnapshot(type, 'my-widget', 'update', 'agent', 'Edited', '1.0.0');
  });
  afterEach(() => t.cleanup());

  const rows = async () => {
    const res = await request(t.app).get(`/api/entities/${type}/my-widget/versions`);
    expect(res.status).toBe(200);
    return res.body.versions as Array<Record<string, unknown>>;
  };

  it('[entity:entity-version-meta] every row of the live payload has each DTO field with its type, releaseId null when unreleased and set when released', async () => {
    const versions = await rows();
    expect(versions).toHaveLength(2);
    for (const row of versions) {
      expect(typeof row.version).toBe('number');
      expect(['user', 'agent']).toContain(row.changedBy);
      expect(typeof row.changeSummary).toBe('string');
      expect(typeof row.createdAt).toBe('string');
      expect(Number.isNaN(Date.parse(row.createdAt as string))).toBe(false);
      // `releaseId` is always present: a number or null, never omitted.
      expect(row).toHaveProperty('releaseId');
      expect(row.releaseId === null || typeof row.releaseId === 'number').toBe(true);
    }
    const [v2, v1] = versions;
    expect(v2).toMatchObject({ version: 2, changedBy: 'agent', changeSummary: 'Edited', releaseId: null });
    expect(v1).toMatchObject({ version: 1, changedBy: 'user', changeSummary: 'Created', releaseId });
  });

  it('[ac:ac-wiersz-listy-wersji-encji-niewydanej] the row of a not-yet-released version carries null as its release id', async () => {
    const unreleased = (await rows()).find((r) => r.version === 2);
    expect(unreleased).toBeDefined();
    expect(unreleased).toHaveProperty('releaseId');
    expect(unreleased!.releaseId).toBeNull();
  });

  it('[ac:ac-wiersz-listy-wersji-encji-przypisany] the row of a version assigned to a release carries that release\'s id', async () => {
    const released = (await rows()).find((r) => r.version === 1);
    expect(released).toBeDefined();
    expect(released!.releaseId).toBe(releaseId);
    // …and it is the id of the release row it belongs to.
    const release = t.db.prepare(`SELECT name FROM spec_release WHERE id = ?`).get(released!.releaseId) as { name: string };
    expect(release.name).toBe('r1');
  });

  it('[entity:get-api-entities-type-slug-versions] GET /api/entities/:type/:slug/versions answers 200 with entity-version-meta rows, and its declared 200 response names that DTO', async () => {
    const res = await request(t.app).get(`/api/entities/${type}/my-widget/versions`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.versions)).toBe(true);
    const dtoFields = ['version', 'changedBy', 'changeSummary', 'createdAt', 'releaseId'];
    for (const row of res.body.versions as Array<Record<string, unknown>>) {
      for (const f of dtoFields) expect(row).toHaveProperty(f);
    }

    // The declared contract: method + path, 200 = an array of `entity-version-meta`.
    expect(ENTITY_VERSIONS_ROUTE.method).toBe('GET');
    expect(ENTITY_VERSIONS_ROUTE.path).toBe('/api/entities/:type/:slug/versions');
    expect(ENTITY_VERSIONS_ROUTE.responses[200]).toEqual({
      dto: 'entity-version-meta',
      type: 'EntityVersionMeta',
      array: true,
      field: 'versions',
    });

    // …and the handler is typed against it: the payload `satisfies` the declared
    // response type, whose rows are the DTO's TypeScript type.
    const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    const router = src('../../../src/server/core/plugin-host/entities-router.ts');
    const handler = /router\.get\('\/:type\/:slug\/versions', [\s\S]*?\n {2}\}\);/.exec(router)?.[0] ?? '';
    expect(handler).toMatch(/res\.status\(200\)\.json\(\{ versions: versions\.listVersions\(type, slug\) \} satisfies EntityVersionListResponse\)/);
    const shared = src('../../../src/shared/entities.ts');
    expect(shared).toMatch(/export interface EntityVersionListResponse \{\s*versions: EntityVersionMeta\[\];\s*\}/);
    expect(shared).toMatch(/releaseId\?: number \| null;/);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
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
    const created = await request(t.app).post('/api/acs').send({ text: 'version capture' });
    expect(created.status).toBe(201);

    const row = t.db
      .prepare(`SELECT serializer_version FROM entity_version WHERE entity_type = 'ac' AND entity_slug = ?`)
      .get(created.body.data.slug) as { serializer_version: string };
    // `ac` moved to payload 2 in 0.2.22, when it gained the reserved `title`.
    expect(row.serializer_version).toBe('2');
  });
});

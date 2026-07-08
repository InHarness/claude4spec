import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { fixtureModule } from '../../helpers/fixture-module.js';

describe('GET /api/entities/:type/:slug/versions — generic for a plugin-contributed type (M17)', () => {
  const type = 'widget';
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp({ extraModules: [fixtureModule(type, { withEntityService: true })] });
    t.db.prepare(`INSERT INTO ${type} (slug, name) VALUES ('my-widget', 'Hello')`).run();
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import type { BackendModule, MountContext } from '../../../src/server/core/plugin-host/types.js';

/**
 * M17: a minimal, real (non-core) plugin module — distinct from every
 * RawEntityType — with its own migrated table, a `getBySlug`-capable entity
 * service (so `assertExists`/`entityExists` resolves it), and a real
 * serializer. Proves the generic `GET /api/entities/:type/:slug/versions`
 * endpoint doesn't distinguish core types from plugin-contributed ones.
 */
function fixtureModule(type: string): BackendModule {
  return {
    type,
    table: type,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 999,
    slugFrom: (d: unknown) => String((d as { slug?: string }).slug ?? ''),
    pathPrefix: `/${type}s`,
    serializer: {
      type,
      version: '1.0.0',
      snapshot: (entity: unknown) => {
        const e = entity as { slug: string; data: Record<string, unknown> };
        return { slug: e.slug, ...e.data };
      },
    } as BackendModule['serializer'],
    systemPrompt: {
      roleNoun: type,
      countStat: { placeholder: `${type}Count`, sqlQuery: 'SELECT 0 AS count', label: type },
      mcpToolsLine: `${type}-tools: ...`,
    },
    backend: {
      migrations: [
        { version: 1, name: `create_${type}`, up: `CREATE TABLE ${type} (slug TEXT PRIMARY KEY NOT NULL, name TEXT);` },
      ],
      mount(ctx: MountContext) {
        ctx.registerEntityService(type, {
          getBySlug: (slug: string) => ctx.db.prepare(`SELECT * FROM ${type} WHERE slug = ?`).get(slug) ?? null,
        });
      },
    },
  };
}

describe('GET /api/entities/:type/:slug/versions — generic for a plugin-contributed type (M17)', () => {
  const type = 'widget';
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp({ extraModules: [fixtureModule(type)] });
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

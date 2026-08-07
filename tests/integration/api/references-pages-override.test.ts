import express from 'express';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { referencesRouter } from '../../../src/server/routes/references.js';
import type { DiscoveryCore } from '../../../src/server/discovery/types.js';
import type { ReferencesService } from '../../../src/server/services/references.js';
import type { ProjectPluginHost } from '../../../src/server/core/plugin-host/types.js';

/**
 * 0.2.13 (tier C) — `GET /api/references?pages=<dir>`.
 *
 * `--pages <dir>` used to be applied while the CLI assembled a discovery core of
 * its own. With execution moved into the server process the parameter has to
 * reach the ROOT LIST a sweep walks, and the thing that can silently go wrong is
 * that it reaches nothing: the entity arm normally answers from
 * `ReferencesService`, which walks the project's configured roots and has no
 * notion of a narrowed list. A request that was parsed and then answered from
 * the service returns a project-wide sweep labelled as a narrowed one — right
 * status, right shape, wrong answer. So what is asserted here is WHICH core
 * answered, not what it said.
 */

function harness() {
  const seen: string[] = [];
  const narrowed = {
    findReferences: async () => ({ references: [{ from: 'narrowed' }], total: 1, hasMore: false }),
  } as unknown as DiscoveryCore;
  const wide = {
    findReferences: async () => ({ references: [{ from: 'wide-core' }], total: 1, hasMore: false }),
  } as unknown as DiscoveryCore;
  const service = {
    findReferences: async () => [{ from: 'service' }],
  } as unknown as ReferencesService;
  const host = {
    getAvailable: (t: string) => t === 'ac',
    listEntities: () => [{ type: 'ac' }],
  } as unknown as ProjectPluginHost;

  const app = express();
  app.use(
    '/api/references',
    referencesRouter(host, service, wide, (dir) => {
      seen.push(dir);
      return narrowed;
    }),
  );
  return { app, seen };
}

describe('GET /api/references?pages=', () => {
  it('without it, the entity arm still answers from the service', async () => {
    const { app, seen } = harness();
    const res = await request(app).get('/api/references?type=ac&slug=x').expect(200);
    expect(res.body.references[0].from).toBe('service');
    expect(seen).toEqual([]);
  });

  it('with it, the sweep runs on a core built over the narrowed root list', async () => {
    const { app, seen } = harness();
    const res = await request(app).get('/api/references?type=ac&slug=x&pages=docs/guides').expect(200);
    expect(res.body.references[0].from).toBe('narrowed');
    expect(seen).toEqual(['docs/guides']);
  });

  it('narrows the section and page arms too — it names the root list, not a target kind', async () => {
    const { app, seen } = harness();
    const s = await request(app).get('/api/references?target=section&anchor=a1&pages=docs').expect(200);
    expect(s.body.references[0].from).toBe('narrowed');
    const p = await request(app)
      .get('/api/references?target=page&rootId=mainspec&path=a.md&pages=docs')
      .expect(200);
    expect(p.body.references[0].from).toBe('narrowed');
    expect(seen).toEqual(['docs', 'docs']);
  });

  it('an empty or whitespace value is not an override', async () => {
    const { app, seen } = harness();
    await request(app).get('/api/references?type=ac&slug=x&pages=').expect(200);
    await request(app).get('/api/references?type=ac&slug=x&pages=%20%20').expect(200);
    expect(seen).toEqual([]);
  });

  it('refuses to be combined with type=section rather than dropping it silently', async () => {
    // The `section` pseudo-type is answered by the references service, which
    // cannot narrow. A no-op flag is fine when turning it on cannot change the
    // answer; a narrowing quietly dropped is the failure this parameter exists
    // to prevent.
    const { app, seen } = harness();
    const res = await request(app).get('/api/references?type=section&slug=a1&pages=docs').expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(seen).toEqual([]);
    // …and without the override it still answers, as it always has.
    await request(app).get('/api/references?type=section&slug=a1').expect(200);
  });
});

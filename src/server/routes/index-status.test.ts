import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { indexStatusRouter } from './index-status.js';
import { PROJECTION_IDS, ProjectionStatusRegistry } from '../services/projection-status.js';

function app(status: ProjectionStatusRegistry) {
  const a = express();
  a.use(express.json());
  a.use('/_meta/index-status', indexStatusRouter(status));
  return a;
}

/**
 * 0.2.77 (M26) — the settings module's first routes of its own, and the first
 * NAMED path to a manual reindex in the product.
 */
describe('GET /_meta/index-status', () => {
  it('reports one row per projection and rebuilds nothing', async () => {
    const status = new ProjectionStatusRegistry();
    const rebuild = vi.fn(async () => {});
    status.registerRebuild(PROJECTION_IDS.entities, rebuild);

    const res = await request(app(status)).get('/_meta/index-status').expect(200);

    expect(res.body.projections).toHaveLength(6);
    expect(res.body.projections[0]).toMatchObject({ id: expect.any(String), state: expect.any(String) });
    // Strictly diagnostic. A status route that repaired what it looked at could
    // not be used to observe a problem.
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('carries the scope of a marking and the last SUCCESSFUL rebuild time', async () => {
    const status = new ProjectionStatusRegistry();
    status.markStale(PROJECTION_IDS.sections, 'pages:a.md');
    const res = await request(app(status)).get('/_meta/index-status').expect(200);
    const row = res.body.projections.find((r: { id: string }) => r.id === PROJECTION_IDS.sections);
    expect(row).toMatchObject({ state: 'stale', scope: ['pages:a.md'], lastRebuiltAt: null });
  });
});

describe('POST /_meta/index-status/rebuild', () => {
  it('rebuilds one projection by id and clears its marking', async () => {
    const status = new ProjectionStatusRegistry();
    const rebuild = vi.fn(async () => {});
    status.registerRebuild(PROJECTION_IDS.entities, rebuild);
    status.markStale(PROJECTION_IDS.entities, 'ac');

    const res = await request(app(status))
      .post('/_meta/index-status/rebuild')
      .send({ projection: PROJECTION_IDS.entities })
      .expect(200);

    expect(rebuild).toHaveBeenCalledTimes(1);
    const row = res.body.projections.find((r: { id: string }) => r.id === PROJECTION_IDS.entities);
    expect(row.state).toBe('fresh');
    expect(row.lastRebuiltAt).toEqual(expect.any(Number));
  });

  it('with no projection named, rebuilds every one that has an entry point', async () => {
    const status = new ProjectionStatusRegistry();
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    status.registerRebuild(PROJECTION_IDS.entities, a);
    status.registerRebuild(PROJECTION_IDS.todos, b);

    await request(app(status)).post('/_meta/index-status/rebuild').send({}).expect(200);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('is idempotent and allowed on a projection that is already fresh', async () => {
    const status = new ProjectionStatusRegistry();
    status.registerRebuild(PROJECTION_IDS.todos, async () => {});
    await request(app(status)).post('/_meta/index-status/rebuild').send({ projection: PROJECTION_IDS.todos }).expect(200);
    // The button exists so a user who SUSPECTS something can check; one that
    // refused when all looked well could not be used for that.
    await request(app(status)).post('/_meta/index-status/rebuild').send({ projection: PROJECTION_IDS.todos }).expect(200);
  });

  it('names the projections that exist when handed one that does not', async () => {
    const status = new ProjectionStatusRegistry();
    const res = await request(app(status))
      .post('/_meta/index-status/rebuild')
      .send({ projection: 'm99-imaginary' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
    expect(res.body.error.hint).toContain(PROJECTION_IDS.sections);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';

// R3: GET /api/entities/counts — one light aggregate feeding the sidebar ELEMENTS
// badges instead of fetching every entity's full list per page view.
describe('GET /api/entities/counts', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('returns a per-type count map, zero for empty types', async () => {
    const res = await request(t.app).get('/api/entities/counts');
    expect(res.status).toBe(200);
    expect(res.body.endpoint).toBe(0);
    expect(res.body.dto).toBe(0);
    expect(res.body['ui-view']).toBe(0);
  });

  it('reflects created entities', async () => {
    expect((await request(t.app).post('/api/ui-views').send({ name: 'Profile' })).status).toBe(201);
    expect((await request(t.app).post('/api/ui-views').send({ name: 'Settings' })).status).toBe(201);

    const res = await request(t.app).get('/api/entities/counts');
    expect(res.status).toBe(200);
    expect(res.body['ui-view']).toBe(2);
    expect(res.body.endpoint).toBe(0);
    expect(res.body.dto).toBe(0);
  });
});

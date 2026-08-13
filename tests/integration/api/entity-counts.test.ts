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
    expect((await request(t.app).post('/api/ui-views').send({ title: 'Profile' })).status).toBe(201);
    expect((await request(t.app).post('/api/ui-views').send({ title: 'Settings' })).status).toBe(201);

    const res = await request(t.app).get('/api/entities/counts');
    expect(res.status).toBe(200);
    expect(res.body['ui-view']).toBe(2);
    expect(res.body.endpoint).toBe(0);
    expect(res.body.dto).toBe(0);
  });
});

/**
 * 0.2.4 — `systemPrompt.countStat` is deprecated and its `sqlQuery` is no longer
 * executed. That slot was the ONLY place a module handed the host raw SQL to
 * run, and closing the surface is the point.
 *
 * The brief's acceptance criterion is a PARITY one, and it is worth stating why
 * it needed a test: before this, the sidebar counted through the reader while
 * the agent prompt counted through each type's own query. Only AC's query
 * carried a predicate (`status='active'`), so exactly one type reported a
 * different number to the agent than to the user looking at the screen — with
 * nothing anywhere to say so.
 */
describe('entity counts — one number per type, whoever asks', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('the agent-prompt aggregate and the sidebar aggregate agree, type for type', async () => {
    expect((await request(t.app).post('/api/ui-views').send({ title: 'Profile' })).status).toBe(201);
    expect((await request(t.app).post('/api/ui-views').send({ title: 'Settings' })).status).toBe(201);

    const sidebar = (await request(t.app).get('/api/entities/counts')).body as Record<string, number>;
    const prompt = t.host.computeEntityCounts(t.db);

    expect(Object.keys(prompt).length).toBeGreaterThan(0);
    for (const [type, count] of Object.entries(prompt)) {
      expect({ type, count }).toEqual({ type, count: sidebar[type] });
    }
    expect(prompt['ui-view']).toBe(2);
  });

  it('never executes a countStat query, even one that would throw', () => {
    // A module may still carry the deprecated slot through the deprecation
    // window. If the host executed it, this SQL would throw and the type would
    // report 0; ignoring it is what keeps the count honest.
    const module = t.host.getEntity('ui-view')!;
    (module.systemPrompt as { countStat?: unknown }).countStat = {
      placeholder: 'x',
      sqlQuery: 'SELECT count FROM a_table_that_does_not_exist',
      label: 'X',
    };
    expect(() => t.host.computeEntityCounts(t.db)).not.toThrow();
    expect(t.host.computeEntityCounts(t.db)['ui-view']).toBe(0);
  });
});

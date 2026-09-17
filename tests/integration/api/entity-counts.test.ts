import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { RawEntityReader } from '../../../src/server/discovery/raw-entity-reader.js';

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
 * 0.2.92 — the system prompt carries no counts; the entity counter has two
 * consumers left, the sidebar aggregate and the agent's
 * `list_entities({ mode: 'count' })`. Both must hit the SAME
 * `RawEntityReader.count(type)`, under the type's declared predicate, so the
 * number the agent sees is the number the user sees.
 *
 * History: before 0.2.4 the prompt counted through each type's own SQL and only
 * `ac` carried a predicate, so exactly one type told the agent a different
 * number than the screen — with nothing anywhere to say so.
 */
describe('entity counts — one number per type, whoever asks', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    t.cleanup();
  });

  const agentCount = (type: string): number => {
    const page = t.mcpSurfaceDeps('chat').reader.discovery.listEntities({
      type,
      mode: 'count',
      applyDefaultPredicate: true,
    });
    return page.total;
  };

  it('[ac:ac-licznik-encji-per-typ-liczy-host-przez] the sidebar aggregate and list_entities count agree, through the same reader.count', async () => {
    expect((await request(t.app).post('/api/ui-views').send({ title: 'Profile' })).status).toBe(201);
    expect((await request(t.app).post('/api/ui-views').send({ title: 'Settings' })).status).toBe(201);
    const acA = await request(t.app).post('/api/acs').send({ title: 'kept active' });
    expect(acA.status).toBe(201);
    const acB = await request(t.app).post('/api/acs').send({ title: 'deprecated one', status: 'deprecated' });
    expect(acB.status).toBe(201);

    const count = vi.spyOn(RawEntityReader.prototype, 'count');
    const sidebar = (await request(t.app).get('/api/entities/counts')).body as Record<string, number>;
    const sidebarCalls = new Set(count.mock.calls.map((c) => c[0]));
    count.mockClear();

    for (const type of Object.keys(sidebar)) {
      expect({ type, count: agentCount(type) }).toEqual({ type, count: sidebar[type] });
    }
    const agentCalls = new Set(count.mock.calls.map((c) => c[0]));
    expect(agentCalls).toEqual(sidebarCalls);

    expect(sidebar['ui-view']).toBe(2);
    // the declared predicate: only active ACs, and the key stays the type name
    expect(sidebar.ac).toBe(1);
    expect(Object.keys(sidebar).some((k) => /\(/.test(k))).toBe(false);
  });

  it('a filtered or tagged count still walks the core enumeration, not the badge', () => {
    const count = vi.spyOn(RawEntityReader.prototype, 'count');
    t.mcpSurfaceDeps('chat').reader.discovery.listEntities({
      type: 'ac',
      mode: 'count',
      applyDefaultPredicate: true,
      filters: { status: ['active', 'deprecated'] },
    });
    expect(count).not.toHaveBeenCalled();
  });

  it('a deactivated type drops out of the sidebar aggregate', async () => {
    const before = (await request(t.app).get('/api/entities/counts')).body as Record<string, number>;
    expect(before).toHaveProperty('ui-view');
    const listEntities = t.host.listEntities.bind(t.host);
    vi.spyOn(t.host, 'listEntities').mockImplementation(() => listEntities().filter((m) => m.type !== 'ui-view'));
    const after = (await request(t.app).get('/api/entities/counts')).body as Record<string, number>;
    expect(after).not.toHaveProperty('ui-view');
    expect(after).toHaveProperty('dto');
  });
});

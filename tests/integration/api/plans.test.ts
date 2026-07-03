import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';

function seedPlan(db: TestApp['db'], title: string | null, content: string): number {
  const info = db
    .prepare(
      `INSERT INTO plan (title, content, current_version, updated_at)
       VALUES (?, ?, 1, datetime('now'))`,
    )
    .run(title, content);
  return Number(info.lastInsertRowid);
}

describe('GET /api/plans', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('[ac:ac-get-api-plans-zwraca-planslistrespon] returns PlansListResponse with title search and limit/offset pagination', async () => {
    seedPlan(t.db, 'Alpha rollout plan', 'first');
    seedPlan(t.db, 'Beta migration plan', 'second');
    seedPlan(t.db, null, 'untitled body');

    const all = await request(t.app).get('/api/plans');
    expect(all.status).toBe(200);
    expect(all.body.data.total).toBe(3);
    expect(all.body.data.plans).toHaveLength(3);

    const searched = await request(t.app).get('/api/plans').query({ search: 'beta' });
    expect(searched.body.data.total).toBe(1);
    expect(searched.body.data.plans[0].title).toBe('Beta migration plan');

    const page = await request(t.app).get('/api/plans').query({ limit: 2, offset: 2 });
    expect(page.body.data.total).toBe(3);
    expect(page.body.data.plans).toHaveLength(1);
  });

  it('[ac:ac-planservice-listplans-search-limit] list items carry threadCount and lastThreadId, sorted DESC by updated_at', async () => {
    const oldId = seedPlan(t.db, 'Old plan', 'old');
    t.db
      .prepare(`UPDATE plan SET updated_at = datetime('now', '-1 day') WHERE id = ?`)
      .run(oldId);
    const freshId = seedPlan(t.db, 'Fresh plan', 'fresh');
    t.db
      .prepare(
        `INSERT INTO chat_thread (id, title, plan_id, created_at, updated_at)
         VALUES ('thread-1', 't1', ?, datetime('now', '-1 hour'), datetime('now', '-1 hour')),
                ('thread-2', 't2', ?, datetime('now'), datetime('now'))`,
      )
      .run(freshId, freshId);

    const res = await request(t.app).get('/api/plans');
    expect(res.status).toBe(200);
    const { plans, total } = res.body.data;
    expect(total).toBe(2);
    expect(plans.map((p: { id: number }) => p.id)).toEqual([freshId, oldId]);
    const fresh = plans[0];
    expect(fresh.threadCount).toBe(2);
    expect(fresh.lastThreadId).toBe('thread-2');
    expect(plans[1].threadCount).toBe(0);
    expect(plans[1].lastThreadId).toBeNull();
  });
});

describe('GET /api/plans/:planId/threads', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('returns the plan threads (PlanThreadItem) DESC by updated_at, excluding child threads', async () => {
    const planId = seedPlan(t.db, 'P2 plan', 'body');
    t.db
      .prepare(
        `INSERT INTO chat_thread (id, title, plan_id, parent_thread_id, created_at, updated_at)
         VALUES ('th-old',   'old',   ?, NULL,      datetime('now','-2 hour'), datetime('now','-2 hour')),
                ('th-new',   'new',   ?, NULL,      datetime('now'),           datetime('now')),
                ('th-child', 'child', ?, 'th-new',  datetime('now'),           datetime('now'))`,
      )
      .run(planId, planId, planId);

    const res = await request(t.app).get(`/api/plans/${planId}/threads`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((x: { id: string }) => x.id)).toEqual(['th-new', 'th-old']);
    expect(res.body.data[0]).toEqual({ id: 'th-new', title: 'new', updatedAt: expect.any(String) });
  });

  it('404s for a missing plan', async () => {
    const res = await request(t.app).get('/api/plans/9999/threads');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/plans/by-anchor/:anchor', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('resolves a plan heading anchor to { planId, threadId }', async () => {
    const planId = seedPlan(t.db, 'Anchored plan', '<!-- anchor: abcd1234 -->\n## Section\n\nbody');
    t.db
      .prepare(
        `INSERT INTO chat_thread (id, title, plan_id, created_at, updated_at)
         VALUES ('th-1', 't1', ?, datetime('now'), datetime('now'))`,
      )
      .run(planId);

    const res = await request(t.app).get('/api/plans/by-anchor/abcd1234');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ planId, threadId: 'th-1' });
  });

  it('resolves with threadId null when the plan has no thread', async () => {
    const planId = seedPlan(t.db, 'Lonely plan', '<!-- anchor: deadbeef -->\n## S\n\nx');
    const res = await request(t.app).get('/api/plans/by-anchor/deadbeef');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ planId, threadId: null });
  });

  it('404s for an unknown anchor', async () => {
    seedPlan(t.db, 'Some plan', '<!-- anchor: abcd1234 -->\n## S\n\nx');
    const res = await request(t.app).get('/api/plans/by-anchor/99999999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('does not leak plans through a LIKE-wildcard anchor', async () => {
    seedPlan(t.db, 'Some plan', '<!-- anchor: abcd1234 -->\n## S\n\nx');
    const res = await request(t.app).get('/api/plans/by-anchor/%25'); // decodes to "%"
    expect(res.status).toBe(404);
  });
});

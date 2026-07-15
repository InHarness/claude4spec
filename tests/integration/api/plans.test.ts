import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { PLAN_ROOT_MARKER } from '../../../src/shared/types.js';

/** Writes a plan `.md` file + captures its file_version + indexes it — mirrors artifacts.test.ts's writeArtifact. */
async function seedPlan(t: TestApp, slug: string, title: string, body: string): Promise<string> {
  const relPath = `${slug}.md`;
  await t.plansPages.write(relPath, {
    frontmatter: { type: 'plan', title, created_at: new Date().toISOString(), created_by: 'user' },
    body,
  });
  await t.frontmatterIndexer.indexPage(PLAN_ROOT_MARKER, relPath);
  await t.pageVersions.recordVersion(relPath, 'create', 'filesystem', undefined, t.plansSerializer, PLAN_ROOT_MARKER);
  return relPath;
}

function seedThread(t: TestApp, id: string, opts: { planPath?: string; parentThreadId?: string } = {}): void {
  t.db
    .prepare(
      `INSERT INTO chat_thread (id, title, plan_path, parent_thread_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
    .run(id, id, opts.planPath ?? null, opts.parentThreadId ?? null);
}

// 0.1.127: plan listing moved to the generic M36 family (GET /api/plans is
// gone, see brief 0-1-126-to-0-1-127) — no `total`/pagination (limit/offset)
// on the generic list, matching brief/patch's own list endpoint. threadCount/
// lastThreadId (ac-planservice-listplans-search-limit) are PlanService-level
// concerns not surfaced on the generic wire shape — covered directly against
// the service in tests/integration/db/plans.test.ts instead.
describe('GET /api/artifacts/plan', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('[ac:ac-get-api-plans-zwraca-planslistrespon] lists plans and supports title search', async () => {
    await seedPlan(t, 'alpha-rollout-plan', 'Alpha rollout plan', 'first');
    await seedPlan(t, 'beta-migration-plan', 'Beta migration plan', 'second');
    await seedPlan(t, 'untitled', 'untitled', 'untitled body');

    const all = await request(t.app).get('/api/artifacts/plan');
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(3);

    const searched = await request(t.app).get('/api/artifacts/plan').query({ search: 'beta' });
    expect(searched.body.data).toHaveLength(1);
    expect(searched.body.data[0].frontmatter.title).toBe('Beta migration plan');
  });
});

describe('GET /api/plans/:slug/threads', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('returns the plan threads (PlanThreadItem) DESC by updated_at, excluding child threads', async () => {
    const planPath = await seedPlan(t, 'p2-plan', 'P2 plan', 'body');
    t.db
      .prepare(
        `INSERT INTO chat_thread (id, title, plan_path, parent_thread_id, created_at, updated_at)
         VALUES ('th-old',   'old',   ?, NULL,      datetime('now','-2 hour'), datetime('now','-2 hour')),
                ('th-new',   'new',   ?, NULL,      datetime('now'),           datetime('now')),
                ('th-child', 'child', ?, 'th-new',  datetime('now'),           datetime('now'))`,
      )
      .run(planPath, planPath, planPath);

    const res = await request(t.app).get(`/api/plans/${encodeURIComponent(planPath)}/threads`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((x: { id: string }) => x.id)).toEqual(['th-new', 'th-old']);
    expect(res.body.data[0]).toEqual({ id: 'th-new', title: 'new', updatedAt: expect.any(String) });
  });

  it('returns an empty list for a missing plan (no invariant to enforce — attach is optional)', async () => {
    const res = await request(t.app).get('/api/plans/does-not-exist.md/threads');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/plans/by-anchor/:anchor', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('resolves a plan heading anchor to { planPath, threadId }', async () => {
    const planPath = await seedPlan(t, 'anchored-plan', 'Anchored plan', '<!-- anchor: abcd1234 -->\n## Section\n\nbody');
    seedThread(t, 'th-1', { planPath });

    const res = await request(t.app).get('/api/plans/by-anchor/abcd1234');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ planPath, threadId: 'th-1' });
  });

  it('resolves with threadId null when the plan has no thread', async () => {
    const planPath = await seedPlan(t, 'lonely-plan', 'Lonely plan', '<!-- anchor: deadbeef -->\n## S\n\nx');
    const res = await request(t.app).get('/api/plans/by-anchor/deadbeef');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ planPath, threadId: null });
  });

  it('404s for an unknown anchor', async () => {
    await seedPlan(t, 'some-plan', 'Some plan', '<!-- anchor: abcd1234 -->\n## S\n\nx');
    const res = await request(t.app).get('/api/plans/by-anchor/99999999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('does not leak plans through a LIKE-wildcard anchor', async () => {
    await seedPlan(t, 'some-plan', 'Some plan', '<!-- anchor: abcd1234 -->\n## S\n\nx');
    const res = await request(t.app).get('/api/plans/by-anchor/%25'); // decodes to "%"
    expect(res.status).toBe(404);
  });
});

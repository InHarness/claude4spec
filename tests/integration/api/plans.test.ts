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

// 0.1.139: `GET /api/plans/:slug/threads` is GONE — listing an artifact's
// threads is generic across brief/patch/plan (one endpoint, one
// `ChatService.listThreadsByArtifact` query resolved through
// `artifactRegistry[kind].binding.threadColumn`).
describe('GET /api/artifacts/plan/:path/threads', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('returns the plan threads (ArtifactThreadListItem) DESC by updated_at, excluding child threads', async () => {
    const planPath = await seedPlan(t, 'p2-plan', 'P2 plan', 'body');
    t.db
      .prepare(
        `INSERT INTO chat_thread (id, title, plan_path, parent_thread_id, created_at, updated_at)
         VALUES ('th-old',   'old',   ?, NULL,      datetime('now','-2 hour'), datetime('now','-2 hour')),
                ('th-new',   'new',   ?, NULL,      datetime('now'),           datetime('now')),
                ('th-child', 'child', ?, 'th-new',  datetime('now'),           datetime('now'))`,
      )
      .run(planPath, planPath, planPath);

    const res = await request(t.app).get(`/api/artifacts/plan/${encodeURIComponent(planPath)}/threads`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((x: { id: string }) => x.id)).toEqual(['th-new', 'th-old']);
    expect(res.body.data[0]).toEqual({
      id: 'th-new',
      title: 'new',
      contextType: 'chat',
      planMode: false,
      messageCount: 0,
      hasSystemPrompt: false,
      updatedAt: expect.any(String),
      // Freshest row of the first page — the "open last thread" shortcut.
      isLast: true,
    });
    expect(res.body.data[1].isLast).toBe(false);
  });

  it('returns an empty list for a missing plan (no invariant to enforce — attach is optional)', async () => {
    const res = await request(t.app).get('/api/artifacts/plan/does-not-exist.md/threads');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// 0.1.138: `POST /api/plans/:slug/execute` (modes new-session/continue) is gone
// — create-thread is now the ONLY "run a plan" path, and the execution prompt
// lives client-side as an editable composer draft (PlanPage's Run plan /
// Analyse plan). The backend generates no firstMessage and never flips
// chat_thread.plan_mode.
describe('POST /api/plans/:slug/create-thread', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('creates a new thread attached to the plan and returns { threadId }', async () => {
    const planPath = await seedPlan(t, 'runnable-plan', 'Runnable plan', 'do the thing');

    const res = await request(t.app).post(`/api/plans/${encodeURIComponent(planPath)}/create-thread`);
    expect(res.status).toBe(201);
    expect(res.body.data.threadId).toEqual(expect.any(String));

    const row = t.db
      .prepare(`SELECT plan_path, plan_mode FROM chat_thread WHERE id = ?`)
      .get(res.body.data.threadId) as { plan_path: string; plan_mode: number };
    expect(row.plan_path).toBe(planPath);
    // No server-side plan_mode toggle on plan execution — the flag only moves
    // through PATCH /api/threads/:id and POST /api/chat.
    expect(row.plan_mode).toBe(0);
  });

  it('always creates a NEW thread, never reuses the attached one', async () => {
    const planPath = await seedPlan(t, 'twice-plan', 'Twice plan', 'body');

    const first = await request(t.app).post(`/api/plans/${encodeURIComponent(planPath)}/create-thread`);
    const second = await request(t.app).post(`/api/plans/${encodeURIComponent(planPath)}/create-thread`);
    expect(first.body.data.threadId).not.toBe(second.body.data.threadId);

    const threads = await request(t.app).get(`/api/artifacts/plan/${encodeURIComponent(planPath)}/threads`);
    expect(threads.body.data).toHaveLength(2);
  });

  it('404s on the removed POST /api/plans/:slug/execute', async () => {
    const planPath = await seedPlan(t, 'gone-plan', 'Gone plan', 'body');
    const res = await request(t.app)
      .post(`/api/plans/${encodeURIComponent(planPath)}/execute`)
      .send({ mode: 'new-session' });
    expect(res.status).toBe(404);
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

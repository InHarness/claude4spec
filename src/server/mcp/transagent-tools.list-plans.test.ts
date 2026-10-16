import { describe, expect, it } from 'vitest';
import matter from 'gray-matter';
import { buildTransagentToolsServer, TRANSAGENT_TOOL_NAMES } from './transagent-tools.js';
import { PlanService } from '../services/plan.js';
import type { TransagentDispatcher } from '../services/transagent-dispatcher.js';
import { systemRootId } from '../../shared/root-kinds.js';
import { DEFAULT_LIMITS, MAX_LIMIT, resolvePageRequest } from '../discovery/pagination.js';
import { PLAN_TOOL_RECORDS } from '../../../tests/helpers/plan-tool-records.js';
import { expectToolMatchesToolRecord } from '../../../tests/helpers/write-tool-records.js';

/**
 * 2.1.18 (M10 `ww4lujgo` / `m10mcp00`, M44 `3f5ej79s`, M05 `iatop5pj`) —
 * `list_plans`, rendered in `transagent-tools` for the top-level chat
 * orchestrator (the server is mounted only there — asserted in
 * agent-turn.test.ts). A REAL `PlanService.listPlans` (the `applied` filter read
 * as `fm.applied === true`, the `order: 'created'` sort) over an in-memory
 * frontmatter index whose records are parsed from raw plan files by gray-matter
 * — the same parse the real indexer does, so an unquoted `created_at` arrives as
 * a `Date`. Every plan has a version whose content carries a body marker, so a
 * row that leaked plan content would show it.
 */

type Rec = { rootId: string; path: string; frontmatter: Record<string, unknown> };

const PLANS = systemRootId('plans');
const BODY_MARKER = 'SECRET-PLAN-BODY';

function planFile(fm: Record<string, string | boolean>): Record<string, unknown> {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${String(v)}`);
  return matter(['---', 'type: plan', ...lines, '---', '', `# Plan\n\n${BODY_MARKER}`, ''].join('\n')).data;
}

function serviceOver(plans: Record<string, Record<string, unknown>>, updatedAt: Record<string, string> = {}) {
  const records: Rec[] = Object.entries(plans).map(([p, frontmatter]) => ({ rootId: PLANS, path: p, frontmatter }));
  const frontmatterIndexer = {
    // The real indexer answers sorted by path — the order list_plans must NOT keep.
    findByFrontmatterType: (type: string, opts: { rootId?: string } = {}) =>
      records
        .filter((r) => r.frontmatter.type === type && (!opts.rootId || r.rootId === opts.rootId))
        .sort((a, b) => a.path.localeCompare(b.path)),
  };
  return new PlanService({
    plansPages: { rootId: PLANS },
    frontmatterIndexer,
    pageVersions: {
      getLatestForPath: (p: string) => ({
        createdAt: updatedAt[p] ?? '2026-10-10T00:00:00.000Z',
        data: { content: `---\ntype: plan\n---\n# Plan\n\n${BODY_MARKER}\n` },
      }),
    },
    chatService: { threadCountForPlan: () => 0, findLastThreadIdForPlan: () => null },
  } as unknown as ConstructorParameters<typeof PlanService>[0]);
}

const dispatcher = { run: async () => ({ threadId: 'c', summary: '' }) } as unknown as TransagentDispatcher;

function listTool(service: PlanService) {
  const server = buildTransagentToolsServer({
    parentThreadId: 'parent_1',
    dispatcher,
    patches: { listPatches: () => [] },
    briefs: { listBriefs: () => [] },
    plans: service,
    projectId: 'p1',
  });
  const tool = server.tools.find((t) => t.name === 'list_plans');
  if (!tool) throw new Error('list_plans not registered');
  return { server, tool };
}

async function list(service: PlanService, args: Record<string, unknown> = {}) {
  const res = (await listTool(service).tool.handler(args)) as { isError?: boolean; content: Array<{ text: string }> };
  return {
    isError: res.isError === true,
    raw: res.content[0]!.text,
    body: JSON.parse(res.content[0]!.text) as Record<string, any>,
  };
}

const paths = (body: Record<string, any>) => (body.plans as Array<{ path: string }>).map((p) => p.path);

describe('transagent-tools · list_plans (2.1.18)', () => {
  it('[section:m10mcp00] is registered on transagent-tools beside runTransagent, list_patches and list_briefs, read-only, with optional applied / limit / offset only', () => {
    const { server, tool } = listTool(serviceOver({}));
    expect(server.tools.map((t) => t.name)).toEqual([...TRANSAGENT_TOOL_NAMES]);
    expect(TRANSAGENT_TOOL_NAMES).toContain('list_plans');
    const shape = tool.inputSchema as Record<string, { isOptional(): boolean }>;
    // No `search`: `search_plans` is `n/a` — a plan is reached by its address, not a query.
    expect(Object.keys(shape).sort()).toEqual(['applied', 'limit', 'offset']);
    for (const k of Object.keys(shape)) expect(shape[k]!.isOptional(), k).toBe(true);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it('[ac:ac-list-plans-wywolane-w-watku-chat-top] list_plans (the top-level chat thread\'s transagent-tools) returns the project\'s plans without their content', async () => {
    const service = serviceOver({
      'alpha.md': planFile({ title: 'Alpha', created_at: '2026-10-01T00:00:00.000Z', created_by: 'agent', applied: false }),
      'beta.md': planFile({ title: 'Beta', created_at: '2026-10-02T00:00:00.000Z', created_by: 'user', applied: true }),
      // Legacy plan: no `applied` key — reads as `false`.
      'gamma.md': planFile({ title: 'Gamma', created_at: '2026-10-03T00:00:00.000Z', created_by: 'agent' }),
    });
    const { isError, raw, body } = await list(service);
    expect(isError).toBe(false);

    // The project's plans — every one of them.
    expect(paths(body).sort()).toEqual(['alpha.md', 'beta.md', 'gamma.md']);
    expect(body.total).toBe(3);
    expect(body.hasMore).toBe(false);
    expect(body.plans).toEqual([
      { path: 'alpha.md', title: 'Alpha', applied: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' },
      { path: 'beta.md', title: 'Beta', applied: true, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' },
      { path: 'gamma.md', title: 'Gamma', applied: false, createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' },
    ]);

    // Without their content: no body/content/frontmatter/hash field on a row, and
    // the plan body (present in every plan's version) appears nowhere in the answer.
    for (const row of body.plans as Array<Record<string, unknown>>) {
      for (const k of ['content', 'body', 'frontmatter', 'hash']) expect(row, k).not.toHaveProperty(k);
    }
    expect(raw).not.toContain(BODY_MARKER);

    // And the `applied` filter narrows the same set.
    expect(paths((await list(service, { applied: false })).body)).toEqual(['alpha.md', 'gamma.md']);
    expect(paths((await list(service, { applied: true })).body)).toEqual(['beta.md']);
  });

  it('[ac:ac-list-plans-zwraca-plany-w-porzadku-cr] list_plans returns plans ordered by created_at ascending (ties by path, undated last) — not the /plans page\'s most-recently-changed order', async () => {
    const service = serviceOver(
      {
        'a-late.md': planFile({ title: 'A', created_at: '2026-10-03T00:00:00.000Z', created_by: 'agent' }),
        'b-early.md': planFile({ title: 'B', created_at: '2026-10-01T00:00:00.000Z', created_by: 'agent' }),
        'z-tie.md': planFile({ title: 'Z', created_at: '2026-10-02T00:00:00.000Z', created_by: 'agent' }),
        'c-tie.md': planFile({ title: 'C', created_at: '2026-10-02T00:00:00.000Z', created_by: 'agent' }),
        'y-undated.md': planFile({ title: 'Y', created_by: 'agent' }),
        'd-undated.md': planFile({ title: 'D', created_by: 'agent' }),
      },
      // The earliest-created plan was changed last — the /plans order puts it first.
      { 'b-early.md': '2026-10-12T00:00:00.000Z', 'a-late.md': '2026-10-11T00:00:00.000Z' },
    );
    const { isError, body } = await list(service);
    expect(isError).toBe(false);
    expect(paths(body)).toEqual(['b-early.md', 'c-tie.md', 'z-tie.md', 'a-late.md', 'd-undated.md', 'y-undated.md']);
    // created_at is non-decreasing over the dated prefix.
    const dated = (body.plans as Array<{ createdAt: string | null }>).map((p) => p.createdAt).filter((c): c is string => c !== null);
    expect(dated).toHaveLength(4);
    expect([...dated].sort()).toEqual(dated);

    // The /plans page (default order) keeps its most-recently-changed-first order.
    expect(service.listPlans()[0]!.path).toBe('b-early.md');
    expect(service.listPlans()[1]!.path).toBe('a-late.md');
  });

  it('[section:ww4lujgo] windows the list per the M39 implicit matrix: limit / offset, total before the slice, hasMore, finite default', async () => {
    const many: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < DEFAULT_LIMITS.listPlans + 5; i++) {
      const n = String(i).padStart(3, '0');
      many[`p-${n}.md`] = planFile({ title: `P${n}`, created_at: `2026-01-01T00:00:00.${n}Z`, created_by: 'agent' });
    }
    const service = serviceOver(many);

    const first = (await list(service)).body;
    expect(first.plans).toHaveLength(DEFAULT_LIMITS.listPlans);
    expect(first.total).toBe(DEFAULT_LIMITS.listPlans + 5);
    expect(first.hasMore).toBe(true);

    const page = (await list(service, { limit: 2, offset: 1 })).body;
    expect(paths(page)).toEqual(['p-001.md', 'p-002.md']);
    expect(page.total).toBe(DEFAULT_LIMITS.listPlans + 5);
    expect(page.hasMore).toBe(true);

    const tail = (await list(service, { limit: 10, offset: DEFAULT_LIMITS.listPlans })).body;
    expect(tail.plans).toHaveLength(5);
    expect(tail.hasMore).toBe(false);
  });

  it('[entity:transagent-tools-list-plans] transagent-tools · list_plans: the record\'s name, description, `applied` (boolean) + `limit` / `offset` (integers), all optional, readOnlyHint — `{ plans, total, hasMore }` rows without content, default limit 50 and maximum 1000, default offset 0, empty dates answered as null', async () => {
    const record = PLAN_TOOL_RECORDS['transagent-tools-list-plans'];
    expect(record).toBeDefined();
    const { server, tool } = listTool(serviceOver({}));
    expect(server.tools.find((t) => t.name === 'list_plans')).toBe(tool);
    expectToolMatchesToolRecord(tool, record!);

    const many: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 60; i++) {
      const n = String(i).padStart(3, '0');
      many[`p-${n}.md`] = planFile({ title: `P${n}`, created_at: `2026-01-01T00:00:00.${n}Z`, created_by: 'agent' });
    }
    const service = serviceOver(many);
    const first = (await list(service)).body;
    expect(Object.keys(first).sort()).toEqual(['hasMore', 'plans', 'total']);
    // Default limit 50, default offset 0: the window starts at the head of the list.
    expect(DEFAULT_LIMITS.listPlans).toBe(50);
    expect(first.plans).toHaveLength(50);
    expect(first.total).toBe(60);
    expect(first.hasMore).toBe(true);
    expect(paths(first)).toEqual(paths((await list(service, { offset: 0, limit: 50 })).body));
    expect(paths(first)[0]).toBe('p-000.md');
    // The maximum: a limit above 1000 is answered as 1000, not refused.
    expect(MAX_LIMIT).toBe(1000);
    expect(resolvePageRequest({ limit: 5000 }, DEFAULT_LIMITS.listPlans)).toEqual({ limit: 1000, offset: 0 });
    const over = await list(service, { limit: 5000 });
    expect(over.isError).toBe(false);
    expect(over.body.plans).toHaveLength(60);
    expect(over.body.hasMore).toBe(false);

    // A plan with no created_at and no version: both dates come back as null.
    const undated = new PlanService({
      plansPages: { rootId: PLANS },
      frontmatterIndexer: {
        findByFrontmatterType: () => [{ rootId: PLANS, path: 'bare.md', frontmatter: planFile({ title: 'Bare' }) }],
      },
      pageVersions: { getLatestForPath: () => undefined },
      chatService: { threadCountForPlan: () => 0, findLastThreadIdForPlan: () => null },
    } as unknown as ConstructorParameters<typeof PlanService>[0]);
    expect((await list(undated)).body.plans).toEqual([
      { path: 'bare.md', title: 'Bare', applied: false, createdAt: null, updatedAt: null },
    ]);
  });

  it('a rig without the plan set does not register list_plans', () => {
    const server = buildTransagentToolsServer({ parentThreadId: 'parent_1', dispatcher });
    expect(server.tools.map((t) => t.name)).toEqual(['runTransagent']);
  });
});

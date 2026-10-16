import { describe, expect, it } from 'vitest';
import { buildTransagentToolsServer, TRANSAGENT_TOOL_NAMES } from './transagent-tools.js';
import { BriefService } from '../services/brief.js';
import type { TransagentDispatcher } from '../services/transagent-dispatcher.js';
import { systemRootId } from '../../shared/root-kinds.js';
import { DEFAULT_LIMITS, MAX_LIMIT, resolvePageRequest } from '../discovery/pagination.js';
import { BRIEF_TOOL_RECORDS } from '../../../tests/helpers/brief-tool-records.js';
import { expectToolMatchesToolRecord } from '../../../tests/helpers/write-tool-records.js';
import { CATALOG } from '../operations/catalog.js';
import { toolAdmittedByProfile } from '../operations/profile-gate.js';

/**
 * 2.1.18 (M21 `01ytpznn` / `0kz2u8g7`, M44 `3f5ej79s`, M05 `iatop5pj`) —
 * `list_briefs`, rendered in `transagent-tools` for the top-level chat
 * orchestrator (the server is mounted only there — asserted in
 * agent-turn.test.ts, together with its absence from a `brief` thread). A REAL
 * `BriefService.listBriefs` (the `implemented` filter, the release-axis sort)
 * over an in-memory frontmatter index and a fixed release axis. Every brief has
 * a version whose content carries a body marker, so a row that leaked brief
 * content would show it.
 */

type Rec = { rootId: string; path: string; frontmatter: Record<string, unknown> };

const BRIEFS = systemRootId('briefs');
const BODY_MARKER = 'SECRET-BRIEF-BODY';
/** The release axis, oldest first — rank = index (as `releaseRankByName` answers). */
const AXIS = ['v1', 'v2', 'v3'];

function brief(fm: {
  title: string;
  from: string | null;
  to: string | null;
  generatedAt: string;
  implemented?: boolean;
}): Record<string, unknown> {
  return {
    type: 'brief',
    title: fm.title,
    from_release: fm.from,
    to_release: fm.to,
    generated_at: fm.generatedAt,
    ...(fm.implemented !== undefined ? { implemented: fm.implemented } : {}),
  };
}

function serviceOver(briefs: Record<string, Record<string, unknown>>) {
  const records: Rec[] = Object.entries(briefs).map(([p, frontmatter]) => ({ rootId: BRIEFS, path: p, frontmatter }));
  const frontmatterIndexer = {
    // The real indexer answers sorted by path — the order list_briefs must NOT keep.
    findByFrontmatterType: (type: string, opts: { rootId?: string } = {}) =>
      records
        .filter((r) => r.frontmatter.type === type && (!opts.rootId || r.rootId === opts.rootId))
        .sort((a, b) => a.path.localeCompare(b.path)),
  };
  return new BriefService({
    briefsPages: { rootId: BRIEFS },
    frontmatterIndexer,
    pageVersions: {
      getLatestForPath: () => ({
        createdAt: '2026-10-10T00:00:00.000Z',
        data: { content: `---\ntype: brief\n---\n# Brief\n\n${BODY_MARKER}\n` },
      }),
    },
    releaseService: { releaseRankByName: () => new Map(AXIS.map((name, i) => [name, i])) },
    chatService: { threadCountForBrief: () => 0 },
  } as unknown as ConstructorParameters<typeof BriefService>[0]);
}

const dispatcher = { run: async () => ({ threadId: 'c', summary: '' }) } as unknown as TransagentDispatcher;

function listTool(service: BriefService) {
  // The turn handler passes all three sets; `list_patches` / `list_plans` are asserted in their own files.
  const server = buildTransagentToolsServer({
    parentThreadId: 'parent_1',
    dispatcher,
    patches: { listPatches: () => [] },
    briefs: service,
    plans: { listPlans: () => [] },
    projectId: 'p1',
  });
  const tool = server.tools.find((t) => t.name === 'list_briefs');
  if (!tool) throw new Error('list_briefs not registered');
  return { server, tool };
}

async function list(service: BriefService, args: Record<string, unknown> = {}) {
  const res = (await listTool(service).tool.handler(args)) as { isError?: boolean; content: Array<{ text: string }> };
  return {
    isError: res.isError === true,
    raw: res.content[0]!.text,
    body: JSON.parse(res.content[0]!.text) as Record<string, any>,
  };
}

const paths = (body: Record<string, any>) => (body.briefs as Array<{ path: string }>).map((b) => b.path);

describe('transagent-tools · list_briefs (2.1.18)', () => {
  it('[section:01ytpznn] is registered on transagent-tools between list_patches and list_plans, read-only, with the catalog row\'s optional implemented / limit / offset; the chat profile admits it', () => {
    const { server, tool } = listTool(serviceOver({}));
    expect(server.tools.map((t) => t.name)).toEqual([...TRANSAGENT_TOOL_NAMES]);
    expect(TRANSAGENT_TOOL_NAMES).toEqual(['runTransagent', 'list_patches', 'list_briefs', 'list_plans']);
    const shape = tool.inputSchema as Record<string, { isOptional(): boolean }>;
    // The `internal` rendering of the catalog row takes exactly the row's input.
    expect(Object.keys(shape).sort()).toEqual(Object.keys(CATALOG.require('list_briefs').inputSchema).sort());
    expect(Object.keys(shape).sort()).toEqual(['implemented', 'limit', 'offset']);
    for (const k of Object.keys(shape)) expect(shape[k]!.isOptional(), k).toBe(true);
    expect(tool.annotations?.readOnlyHint).toBe(true);
    // The gate matches by name: the row must not withhold the tool from the only thread it exists for.
    expect(toolAdmittedByProfile('chat', 'list_briefs')).toBe(true);
  });

  it('[ac:ac-list-briefs-wywolane-w-watku-chat-top] list_briefs (the top-level chat thread\'s transagent-tools) returns the project\'s briefs, on the release axis, without their content', async () => {
    const service = serviceOver({
      'a-v1-v2.md': brief({ title: 'A', from: 'v1', to: 'v2', generatedAt: '2026-10-01T00:00:00.000Z', implemented: true }),
      'b-v2-v3.md': brief({ title: 'B', from: 'v2', to: 'v3', generatedAt: '2026-10-02T00:00:00.000Z' }),
      // Open to the current state from the newest release — the top of the list.
      'c-v3-open.md': brief({ title: 'C', from: 'v3', to: null, generatedAt: '2026-10-03T00:00:00.000Z' }),
      // A release the DB does not know — the tail.
      'd-unknown.md': brief({ title: 'D', from: 'v0', to: 'v9-gone', generatedAt: '2026-10-04T00:00:00.000Z' }),
    });
    const { isError, raw, body } = await list(service);
    expect(isError).toBe(false);

    // The project's briefs — every one of them, newest cycle first, unknown release last.
    expect(paths(body)).toEqual(['c-v3-open.md', 'b-v2-v3.md', 'a-v1-v2.md', 'd-unknown.md']);
    expect(body.total).toBe(4);
    expect(body.hasMore).toBe(false);
    expect(body.briefs[0]).toEqual({
      path: 'c-v3-open.md',
      title: 'C',
      fromRelease: 'v3',
      toRelease: null,
      implemented: false,
      generatedAt: '2026-10-03T00:00:00.000Z',
    });
    expect(body.briefs[2]).toMatchObject({ path: 'a-v1-v2.md', implemented: true });

    // Without their content.
    for (const row of body.briefs as Array<Record<string, unknown>>) {
      for (const k of ['content', 'body', 'frontmatter', 'hash']) expect(row, k).not.toHaveProperty(k);
    }
    expect(raw).not.toContain(BODY_MARKER);

    // The `implemented` filter narrows the same set without reordering the rest,
    // and `total` is counted after it.
    const pending = (await list(service, { implemented: false })).body;
    expect(paths(pending)).toEqual(['c-v3-open.md', 'b-v2-v3.md', 'd-unknown.md']);
    expect(pending.total).toBe(3);
    expect(paths((await list(service, { implemented: true })).body)).toEqual(['a-v1-v2.md']);
  });

  it('[section:0kz2u8g7] windows the release-axis list per the M39 implicit matrix: limit / offset, total before the slice, hasMore, finite default', async () => {
    const many: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < DEFAULT_LIMITS.listBriefs + 5; i++) {
      const n = String(i).padStart(3, '0');
      // One release window, so the tie-break (generated_at desc) decides the order.
      many[`b-${n}.md`] = brief({ title: `B${n}`, from: 'v1', to: 'v2', generatedAt: `2026-01-01T00:00:00.${n}Z` });
    }
    const service = serviceOver(many);

    const first = (await list(service)).body;
    expect(first.briefs).toHaveLength(DEFAULT_LIMITS.listBriefs);
    expect(first.total).toBe(DEFAULT_LIMITS.listBriefs + 5);
    expect(first.hasMore).toBe(true);
    const last = String(DEFAULT_LIMITS.listBriefs + 4).padStart(3, '0');
    expect(paths(first)[0]).toBe(`b-${last}.md`);

    const page = (await list(service, { limit: 2, offset: 1 })).body;
    expect(page.briefs).toHaveLength(2);
    expect(paths(page)).toEqual(paths(first).slice(1, 3));
    expect(page.total).toBe(DEFAULT_LIMITS.listBriefs + 5);
    expect(page.hasMore).toBe(true);

    const tail = (await list(service, { limit: 10, offset: DEFAULT_LIMITS.listBriefs })).body;
    expect(tail.briefs).toHaveLength(5);
    expect(paths(tail)[4]).toBe('b-000.md');
    expect(tail.hasMore).toBe(false);
  });

  it('[entity:transagent-tools-list-briefs] transagent-tools · list_briefs: the record\'s name, description, `implemented` (boolean) + `limit` / `offset` (integers), all optional, readOnlyHint — `{ briefs, total, hasMore }` rows without content, default limit 50 and maximum 1000, default offset 0, an empty generatedAt answered as null', async () => {
    const record = BRIEF_TOOL_RECORDS['transagent-tools-list-briefs'];
    expect(record).toBeDefined();
    const { server, tool } = listTool(serviceOver({}));
    expect(server.tools.find((t) => t.name === 'list_briefs')).toBe(tool);
    expectToolMatchesToolRecord(tool, record!);

    const many: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 60; i++) {
      const n = String(i).padStart(3, '0');
      many[`b-${n}.md`] = brief({ title: `B${n}`, from: 'v1', to: 'v2', generatedAt: `2026-01-01T00:00:00.${n}Z` });
    }
    many['z-undated.md'] = brief({ title: 'Z', from: 'v2', to: null, generatedAt: '' });
    const service = serviceOver(many);

    const first = (await list(service)).body;
    expect(Object.keys(first).sort()).toEqual(['briefs', 'hasMore', 'total']);
    // Default limit 50, default offset 0: the window starts at the head of the list.
    expect(first.briefs).toHaveLength(50);
    expect(first.total).toBe(61);
    expect(first.hasMore).toBe(true);
    expect(paths(first)).toEqual(paths((await list(service, { offset: 0, limit: 50 })).body));
    // The brief open from v2 heads the list; its empty generatedAt comes back as null.
    expect(first.briefs[0]).toEqual({
      path: 'z-undated.md',
      title: 'Z',
      fromRelease: 'v2',
      toRelease: null,
      implemented: false,
      generatedAt: null,
    });
    // The maximum: a limit above 1000 is answered as 1000, not refused.
    expect(MAX_LIMIT).toBe(1000);
    expect(resolvePageRequest({ limit: 5000 }, DEFAULT_LIMITS.listBriefs)).toEqual({ limit: 1000, offset: 0 });
    const over = await list(service, { limit: 5000 });
    expect(over.isError).toBe(false);
    expect(over.body.briefs).toHaveLength(61);
    expect(over.body.hasMore).toBe(false);
  });

  it('a rig without the brief set does not register list_briefs', () => {
    const server = buildTransagentToolsServer({ parentThreadId: 'parent_1', dispatcher });
    expect(server.tools.map((t) => t.name)).toEqual(['runTransagent']);
  });
});

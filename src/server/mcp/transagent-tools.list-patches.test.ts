import { describe, expect, it } from 'vitest';
import matter from 'gray-matter';
import { buildTransagentToolsServer, TRANSAGENT_TOOL_NAMES } from './transagent-tools.js';
import { PatchService } from '../services/patch.js';
import type { TransagentDispatcher } from '../services/transagent-dispatcher.js';
import { systemRootId } from '../../shared/root-kinds.js';
import { DEFAULT_LIMITS } from '../discovery/pagination.js';

/**
 * 2.1.18 (M23 `m23brsv01` / `m23mcp01` / `m23edg01`, M44 `3f5ej79s`) —
 * `list_patches`, rendered in `transagent-tools` for the top-level chat
 * orchestrator. A REAL `PatchService.listPatches` (filters, `applied` read as
 * `fm.applied === true`, the domain order) over an in-memory frontmatter index
 * whose records are parsed from raw patch files by gray-matter — the same parse
 * the real indexer does, so an unquoted `created_at` arrives as a `Date`.
 */

type Rec = { rootId: string; path: string; frontmatter: Record<string, unknown> };

const PATCHES = systemRootId('patches');
const BRIEFS = systemRootId('briefs');

function patchFile(fm: Record<string, string | boolean>): Record<string, unknown> {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${String(v)}`);
  return matter(['---', 'type: patch', ...lines, '---', '', '# Patch', ''].join('\n')).data;
}

function serviceOver(patches: Record<string, Record<string, unknown>>, briefs: string[] = []) {
  const records: Rec[] = [
    ...Object.entries(patches).map(([p, frontmatter]) => ({ rootId: PATCHES, path: p, frontmatter })),
    ...briefs.map((p) => ({ rootId: BRIEFS, path: p, frontmatter: { type: 'brief' } })),
  ];
  const frontmatterIndexer = {
    // The real indexer answers sorted by path — the order listPatches must NOT keep.
    findByFrontmatterType: (type: string, opts: { rootId?: string } = {}) =>
      records
        .filter((r) => r.frontmatter.type === type && (!opts.rootId || r.rootId === opts.rootId))
        .sort((a, b) => a.path.localeCompare(b.path)),
  };
  return new PatchService({
    patchesPages: { rootId: PATCHES },
    frontmatterIndexer,
    pageVersions: { getLatestForPath: () => null },
    chatService: { threadCountForPatch: () => 0 },
  } as unknown as ConstructorParameters<typeof PatchService>[0]);
}

const dispatcher = { run: async () => ({ threadId: 'c', summary: '' }) } as unknown as TransagentDispatcher;

function listTool(service: PatchService) {
  // The turn handler passes both sets; `list_plans` is asserted in its own file.
  const server = buildTransagentToolsServer({
    parentThreadId: 'parent_1',
    dispatcher,
    patches: service,
    plans: { listPlans: () => [] },
    projectId: 'p1',
  });
  const tool = server.tools.find((t) => t.name === 'list_patches');
  if (!tool) throw new Error('list_patches not registered');
  return { server, tool };
}

async function list(service: PatchService, args: Record<string, unknown> = {}) {
  const res = (await listTool(service).tool.handler(args)) as { isError?: boolean; content: Array<{ text: string }> };
  return { isError: res.isError === true, body: JSON.parse(res.content[0]!.text) as Record<string, any> };
}

const paths = (body: Record<string, any>) => (body.patches as Array<{ path: string }>).map((p) => p.path);

describe('transagent-tools · list_patches (2.1.18)', () => {
  it('[section:m23mcp01] is registered on transagent-tools beside runTransagent, read-only, with optional brief / applied / limit / offset', () => {
    const { server, tool } = listTool(serviceOver({}));
    expect(server.tools.map((t) => t.name)).toEqual([...TRANSAGENT_TOOL_NAMES]);
    const shape = tool.inputSchema as Record<string, { isOptional(): boolean }>;
    expect(Object.keys(shape).sort()).toEqual(['applied', 'brief', 'limit', 'offset']);
    for (const k of Object.keys(shape)) expect(shape[k]!.isOptional(), k).toBe(true);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it('[ac:ac-list-patches-zwraca-patche-w-porzadku] returns patches ordered by created_at ascending, ties by path, undated last by path', async () => {
    const service = serviceOver({
      'a-late.md': patchFile({ brief: 'b.md', patch_kind: 'drift', created_at: '2026-10-03T00:00:00.000Z' }),
      'b-early.md': patchFile({ brief: 'b.md', patch_kind: 'drift', created_at: '2026-10-01T00:00:00.000Z' }),
      'z-tie.md': patchFile({ brief: 'b.md', patch_kind: 'drift', created_at: '2026-10-02T00:00:00.000Z' }),
      'c-tie.md': patchFile({ brief: 'b.md', patch_kind: 'drift', created_at: '2026-10-02T00:00:00.000Z' }),
      'y-undated.md': patchFile({ brief: 'b.md', patch_kind: 'drift' }),
      'd-undated.md': patchFile({ brief: 'b.md', patch_kind: 'drift' }),
    });
    const { isError, body } = await list(service);
    expect(isError).toBe(false);
    expect(paths(body)).toEqual(['b-early.md', 'c-tie.md', 'z-tie.md', 'a-late.md', 'd-undated.md', 'y-undated.md']);
    // The created_at values are non-decreasing over the dated prefix.
    const dated = (body.patches as Array<{ createdAt: string | null }>).map((p) => p.createdAt).filter((c): c is string => c !== null);
    expect([...dated].sort()).toEqual(dated);
    // The domain owns the order, so the REST list (same method) gets it too.
    expect(service.listPatches().map((p) => p.path)).toEqual(paths(body));
  });

  it('[ac:ac-list-patches-z-applied-false-zwraca-w] with applied: false returns only patches without applied: true', async () => {
    const service = serviceOver({
      'p1.md': patchFile({ brief: 'b.md', patch_kind: 'drift', applied: true, created_at: '2026-10-01T00:00:00.000Z' }),
      'p2.md': patchFile({ brief: 'b.md', patch_kind: 'drift', applied: false, created_at: '2026-10-02T00:00:00.000Z' }),
      'p3.md': patchFile({ brief: 'b.md', patch_kind: 'missing', created_at: '2026-10-03T00:00:00.000Z' }),
    });
    const { body } = await list(service, { applied: false });
    expect(paths(body)).toEqual(['p2.md', 'p3.md']);
    expect((body.patches as Array<{ applied: boolean }>).every((p) => p.applied === false)).toBe(true);
    expect(body.total).toBe(2);
    // And the mirror filter returns exactly the applied one.
    expect(paths((await list(service, { applied: true })).body)).toEqual(['p1.md']);
  });

  it('[ac:ac-list-patches-z-filtrem-brief-zwraca-w] with the brief filter returns only that brief\'s patches', async () => {
    const service = serviceOver(
      {
        'one-a.md': patchFile({ brief: 'one.md', patch_kind: 'drift', created_at: '2026-10-01T00:00:00.000Z' }),
        'two-a.md': patchFile({ brief: 'two.md', patch_kind: 'drift', created_at: '2026-10-02T00:00:00.000Z' }),
        'one-b.md': patchFile({ brief: 'one.md', patch_kind: 'drift', created_at: '2026-10-03T00:00:00.000Z' }),
        // No `brief:` key — resolved by filename prefix to `one.md`.
        'one-c.md': patchFile({ patch_kind: 'drift', created_at: '2026-10-04T00:00:00.000Z' }),
      },
      ['one.md', 'two.md'],
    );
    const { body } = await list(service, { brief: 'one.md' });
    expect(paths(body)).toEqual(['one-a.md', 'one-b.md', 'one-c.md']);
    expect((body.patches as Array<{ brief: string }>).every((p) => p.brief === 'one.md')).toBe(true);
    expect(paths((await list(service, { brief: 'two.md' })).body)).toEqual(['two-a.md']);
  });

  it('[ac:ac-patch-legacy-ze-status-completed-i-be] a legacy patch with status: completed and no applied field is in list_patches({ applied: false })', async () => {
    const service = serviceOver({
      'legacy.md': patchFile({ brief: 'b.md', patch_kind: 'drift', status: 'completed', created_at: '2026-01-02T00:00:00.000Z' }),
      'done.md': patchFile({ brief: 'b.md', patch_kind: 'drift', applied: true, created_at: '2026-01-03T00:00:00.000Z' }),
    });
    const { body } = await list(service, { applied: false });
    expect(paths(body)).toEqual(['legacy.md']);
    expect(body.patches[0].applied).toBe(false);
  });

  it('[section:m23brsv01] windows the list per the M39 implicit matrix: limit / offset, total before the slice, hasMore, finite default', async () => {
    const many: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < DEFAULT_LIMITS.listPatches + 5; i++) {
      const n = String(i).padStart(3, '0');
      many[`p-${n}.md`] = patchFile({ brief: 'b.md', patch_kind: 'drift', created_at: `2026-01-01T00:00:00.${n}Z` });
    }
    const service = serviceOver(many);

    const first = (await list(service)).body;
    expect(first.patches).toHaveLength(DEFAULT_LIMITS.listPatches);
    expect(first.total).toBe(DEFAULT_LIMITS.listPatches + 5);
    expect(first.hasMore).toBe(true);

    const page = (await list(service, { limit: 2, offset: 1 })).body;
    expect(paths(page)).toEqual(['p-001.md', 'p-002.md']);
    expect(page.total).toBe(DEFAULT_LIMITS.listPatches + 5);
    expect(page.hasMore).toBe(true);

    const tail = (await list(service, { limit: 10, offset: DEFAULT_LIMITS.listPatches })).body;
    expect(tail.patches).toHaveLength(5);
    expect(tail.hasMore).toBe(false);
  });

  it('a rig without the patch set mounts runTransagent alone', () => {
    const server = buildTransagentToolsServer({ parentThreadId: 'parent_1', dispatcher });
    expect(server.tools.map((t) => t.name)).toEqual(['runTransagent']);
  });
});

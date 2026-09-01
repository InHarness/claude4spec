import { describe, expect, it } from 'vitest';
import { createReleaseToolsServer } from './index.js';
import type { ReleaseService } from '../../services/release.js';
import type { GitService } from '../../services/git.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import type { RawDelta, RawDeltaPageChange, SpecSnapshot } from '../../../shared/entities.js';

/**
 * `release_diff`'s SECOND ENGINE — `toIdOrName: "current"`.
 *
 * What is asserted here is the wiring only the tool can get wrong. The delta
 * itself is L2's and is tested there; the projection is tested in
 * `projection.test.ts`. This file is about the three decisions the handler makes
 * before either of them runs: WHICH engine, in WHAT order relative to the name
 * lookup, and what `to` the caller is told it got.
 *
 * The service is a spy rather than a real one on purpose. "The literal is
 * resolved before the name lookup" is a claim about a call that must NOT happen,
 * and only a stub that records its calls can witness an absence.
 */

function release(id: number, name: string): SpecSnapshot['release'] {
  return { id, name, description: '', createdBy: 'agent', createdAt: '2026-09-01T00:00:00.000Z' };
}

function emptyPage(path: string, op: RawDeltaPageChange['op']): RawDeltaPageChange {
  return {
    path,
    op,
    added_sections: [],
    removed_sections: [],
    modified_sections: [],
    moved_sections: [],
    frontmatter_diff: null,
    xml_refs_diff: null,
  };
}

/** The snapshot of the last release: one entity that later disappears, one that stays. */
const V1_SNAPSHOT: SpecSnapshot = {
  release: release(1, 'v1'),
  serializer_versions: {},
  entities: [
    { type: 'endpoint', slug: 'ep-kept', op: 'update', data: { name: 'Kept (old)' } },
    { type: 'dto', slug: 'dto-gone', op: 'update', data: { name: 'Gone' } },
  ],
  pages: [{ path: 'pages/gone.md', op: 'update', data: { content: '' } }],
};

/** The working tree right now: `dto-gone` deleted since v1, `ep-new` added. */
const CURRENT_SNAPSHOT: SpecSnapshot = {
  release: release(0, '__current__'),
  serializer_versions: {},
  entities: [
    { type: 'endpoint', slug: 'ep-kept', op: 'update', data: { name: 'Kept (new)' } },
    { type: 'endpoint', slug: 'ep-new', op: 'create', data: { name: 'New' } },
  ],
  pages: [{ path: 'pages/new.md', op: 'create', data: { content: '' } }],
};

/** What L2 hands back for the unreleased branch — note `to.id === 0`. */
const UNRELEASED_DELTA: RawDelta = {
  from: { id: 1, name: 'v1' },
  to: { id: 0, name: 'current' },
  entities: [
    { type: 'endpoint', slug: 'ep-kept', op: 'updated', changes: [] },
    { type: 'endpoint', slug: 'ep-new', op: 'created', changes: [] },
    { type: 'dto', slug: 'dto-gone', op: 'deleted', changes: [] },
  ],
  pages: [emptyPage('pages/new.md', 'created'), emptyPage('pages/gone.md', 'deleted')],
};

const RELEASE_DELTA: RawDelta = {
  from: { id: 1, name: 'v1' },
  to: { id: 2, name: 'v2' },
  entities: [{ type: 'endpoint', slug: 'ep-kept', op: 'updated', changes: [] }],
  pages: [],
};

interface Calls {
  getReleaseDiff: Array<[unknown, unknown]>;
  getUnreleasedDiff: unknown[];
  unreleasedOpts: unknown[];
  getReleaseSnapshot: unknown[];
  getCurrentSnapshot: number;
}

function harness() {
  const calls: Calls = {
    getReleaseDiff: [],
    getUnreleasedDiff: [],
    unreleasedOpts: [],
    getReleaseSnapshot: [],
    getCurrentSnapshot: 0,
  };
  const releaseService = {
    getReleaseDiff: async (from: unknown, to: unknown) => {
      calls.getReleaseDiff.push([from, to]);
      return RELEASE_DELTA;
    },
    getUnreleasedDiff: async (from: unknown, opts: unknown) => {
      calls.getUnreleasedDiff.push(from);
      calls.unreleasedOpts.push(opts);
      return UNRELEASED_DELTA;
    },
    getReleaseSnapshot: (idOrName: unknown) => {
      calls.getReleaseSnapshot.push(idOrName);
      // A DATABASE THAT ALREADY HOLDS a release called `current` — the shadowing
      // case the resolution order exists to rule out.
      return idOrName === 'current'
        ? { ...V1_SNAPSHOT, release: release(9, 'current') }
        : V1_SNAPSHOT;
    },
    getCurrentSnapshot: () => {
      calls.getCurrentSnapshot += 1;
      return CURRENT_SNAPSHOT;
    },
  } as unknown as ReleaseService;

  const server = createReleaseToolsServer({
    releaseService,
    gitService: {} as GitService,
    ws: { broadcast: () => {} } as unknown as WsEmitter,
  });
  const tool = server.tools.find((t) => t.name === 'release_diff')!;

  const call = async (args: Record<string, unknown>) => {
    const res = (await tool.handler(args, {} as never)) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    return { isError: res.isError === true, body: JSON.parse(res.content[0]!.text) as any };
  };

  return { calls, call };
}

describe('release_diff — the "current" branch', () => {
  it('routes to getUnreleasedDiff and never asks getReleaseDiff for the pair', async () => {
    const { calls, call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'current' });

    expect(res.isError).toBe(false);
    expect(calls.getUnreleasedDiff).toEqual(['v1']);
    expect(calls.getReleaseDiff).toEqual([]);
    expect(calls.getCurrentSnapshot).toBe(1);
  });

  /**
   * The ORDER, which is the whole guarantee. The stub happily resolves a release
   * named `current`; if the handler looked it up first, the literal would lose
   * and the caller would silently get a historical diff.
   */
  it('resolves the literal BEFORE the name lookup, so a real release named `current` cannot shadow it', async () => {
    const { calls, call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'current' });

    expect(res.body.to).toEqual({ id: null, name: 'current' });
    // `from` is still resolved by name; `current` never is.
    expect(calls.getReleaseSnapshot).toEqual(['v1']);
  });

  it('reports `to.id: null` — the only signal that the after side is not frozen', async () => {
    const { call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'current' });
    expect(res.body.to).toEqual({ id: null, name: 'current' });
    expect(res.body.from).toEqual({ id: 1, name: 'v1' });
  });

  it('keeps a numeric `to.id` on the ordinary two-release branch', async () => {
    const { calls, call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'v2' });
    expect(res.body.to).toEqual({ id: 2, name: 'v2' });
    expect(calls.getUnreleasedDiff).toEqual([]);
    expect(calls.getReleaseDiff).toEqual([['v1', 'v2']]);
  });

  /**
   * An entity present in `snapshot(from)` and absent from the working tree is a
   * DELETION, exactly as it would be between two releases. Losing it would make
   * the current-branch delta quietly incomplete.
   */
  it('surfaces op:delete for an entity removed since the release', async () => {
    const { call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'current', summaryOnly: true });
    const entities = res.body.entities as Array<Record<string, unknown>>;
    expect(entities.find((e) => e.slug === 'dto-gone')).toMatchObject({ op: 'delete' });
    expect(res.body.pages).toContainEqual({ path: 'pages/gone.md', op: 'delete' });
  });

  it('summaryOnly returns the FULL identity map on this branch too, ignoring limit', async () => {
    const { call } = harness();
    const res = await call({
      fromIdOrName: 'v1',
      toIdOrName: 'current',
      summaryOnly: true,
      limit: 1,
    });
    expect(res.body.total).toEqual({ entities: 3, pages: 2 });
    expect(res.body.entities).toHaveLength(3);
    expect(res.body.pages).toHaveLength(2);
  });

  it('passes `roots` through to the unreleased engine untouched', async () => {
    const { calls, call } = harness();
    await call({ fromIdOrName: 'v1', toIdOrName: 'current', roots: ['pages'] });
    expect(calls.getUnreleasedDiff).toEqual(['v1']);
    expect(calls.unreleasedOpts).toEqual([{ roots: ['pages'] }]);
  });
});

describe('release_diff — INVALID_DIFF_RANGE', () => {
  it('refuses `from: null` together with `to: "current"` — from nothing to the working tree', async () => {
    const { calls, call } = harness();
    const res = await call({ fromIdOrName: null, toIdOrName: 'current' });

    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('INVALID_DIFF_RANGE');
    // Refused BEFORE any engine ran.
    expect(calls.getUnreleasedDiff).toEqual([]);
    expect(calls.getReleaseDiff).toEqual([]);
  });

  it('still allows `from: null` against a real release (the initial brief)', async () => {
    const { calls, call } = harness();
    const res = await call({ fromIdOrName: null, toIdOrName: 'v2' });
    expect(res.isError).toBe(false);
    expect(calls.getReleaseDiff).toEqual([[null, 'v2']]);
  });

  /** Pagination is validated ahead of the branch — the 0.1.71 rule, unchanged. */
  it('reports INVALID_PAGINATION before it ever looks at the range', async () => {
    const { calls, call } = harness();
    const res = await call({ fromIdOrName: null, toIdOrName: 'current', limit: -1 });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('INVALID_PAGINATION');
    expect(calls.getUnreleasedDiff).toEqual([]);
  });
});

describe('release_diff — what the tool tells an agent about the branch', () => {
  it('documents the literal on the tool and on the parameter, since agents read only those', () => {
    const { call: _call } = harness();
    const server = createReleaseToolsServer({
      releaseService: {} as ReleaseService,
      gitService: {} as GitService,
      ws: { broadcast: () => {} } as unknown as WsEmitter,
    });
    const tool = server.tools.find((t) => t.name === 'release_diff')!;
    expect(tool.description).toContain('toIdOrName: "current"');
    expect(tool.description).toContain('does not reproduce later');
    const to = (tool.inputSchema as Record<string, { description?: string }>).toIdOrName;
    expect(to?.description).toContain('resolved before the name lookup');
    expect(to?.description).toContain('INVALID_DIFF_RANGE');
  });

  it('still exposes five tools — release_restore deliberately has none', () => {
    const server = createReleaseToolsServer({
      releaseService: {} as ReleaseService,
      gitService: {} as GitService,
      ws: { broadcast: () => {} } as unknown as WsEmitter,
    });
    expect(server.tools.map((t) => t.name)).toEqual([
      'release_create',
      'release_list',
      'release_show',
      'release_diff',
      'release_update',
    ]);
  });
});

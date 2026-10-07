import { describe, expect, it } from 'vitest';
import { createReleaseToolsServer } from './index.js';
import type { ReleaseService } from '../../services/release.js';
import type { GitService } from '../../services/git.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import type { RawDelta, FileDiff, SpecSnapshot } from '../../../shared/entities.js';

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

function emptyPage(path: string, op: FileDiff['op']): FileDiff {
  return {
    rootId: 'pages',
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

/** `pages` and `plugins` releasable, `scratch` a working root that never enters a release. */
const ROOTS = [
  { id: 'pages', releasable: true },
  { id: 'plugins', releasable: true },
  { id: 'scratch', releasable: false },
];

interface Calls {
  getReleaseDiff: Array<[unknown, unknown]>;
  releaseOpts: unknown[];
  getUnreleasedDiff: unknown[];
  unreleasedOpts: unknown[];
  getReleaseSnapshot: unknown[];
  getCurrentSnapshot: number;
}

function harness() {
  const calls: Calls = {
    getReleaseDiff: [],
    releaseOpts: [],
    getUnreleasedDiff: [],
    unreleasedOpts: [],
    getReleaseSnapshot: [],
    getCurrentSnapshot: 0,
  };
  const releaseService = {
    getReleaseDiff: async (from: unknown, to: unknown, opts: unknown) => {
      calls.getReleaseDiff.push([from, to]);
      calls.releaseOpts.push(opts);
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
    roots: () => ROOTS,
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
    expect(res.body.pages).toContainEqual(expect.objectContaining({ rootId: 'pages', path: 'pages/gone.md', op: 'delete' }));
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
    expect(calls.unreleasedOpts).toEqual([{ roots: ['pages'], paths: undefined }]);
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
      roots: () => ROOTS,
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
      roots: () => ROOTS,
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

/**
 * 0.2.102 — the page filters. What is asserted here is the refusal taxonomy and
 * its order; the narrowing itself is the engine's (tested against a real
 * service in `release-unreleased-diff.test.ts` and `release-diff-git.test.ts`).
 */
describe('release_diff — `paths` / `roots` validation', () => {
  it('passes `paths` through to the release engine', async () => {
    const { calls, call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', paths: ['plugins/modules/x.md'] });
    expect(res.isError).toBe(false);
    expect(calls.releaseOpts).toEqual([{ roots: undefined, paths: ['plugins/modules/x.md'] }]);
  });

  it('passes `paths` through to the unreleased engine too', async () => {
    const { calls, call } = harness();
    await call({ fromIdOrName: 'v1', toIdOrName: 'current', paths: ['pages/a.md'] });
    expect(calls.unreleasedOpts).toEqual([{ roots: undefined, paths: ['pages/a.md'] }]);
  });

  it('[ac:ac-release-diff-wywolany-z-paths-i-roots] `paths` together with `roots` is CONFLICTING_FILTERS', async () => {
    const { calls, call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', paths: ['pages/a.md'], roots: ['pages'] });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('CONFLICTING_FILTERS');
    expect(calls.getReleaseDiff).toEqual([]);
  });

  it("`paths` without 'pages' in include is CONFLICTING_FILTERS — the mirror of entityTypes without 'entities'", async () => {
    const { call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', include: ['entities'], paths: ['pages/a.md'] });
    expect(res.body.code).toBe('CONFLICTING_FILTERS');
    expect(res.body.error).toContain("'pages'");
  });

  it('[ac:ac-release-diff-wywolany-z-roots-jest-od] `roots: []` is INVALID_ROOTS_FILTER', async () => {
    const { calls, call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', roots: [] });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('INVALID_ROOTS_FILTER');
    expect(calls.getReleaseDiff).toEqual([]);
  });

  it.each([
    ['an unknown root', ['nope']],
    ['a non-releasable root', ['scratch']],
  ])('`roots` with %s is INVALID_ROOTS_FILTER naming the releasable roots', async (_label, roots) => {
    const { calls, call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', roots });
    expect(res.body.code).toBe('INVALID_ROOTS_FILTER');
    expect(res.body.error).toContain('releasable roots: [pages, plugins]');
    expect(res.body.hint).toBe('releasable roots: [pages, plugins]');
    expect(calls.getReleaseDiff).toEqual([]);
  });

  it('[ac:ac-release-diff-z-elementem-paths-pozbaw] an element without a root prefix is INVALID_PATHS_FILTER', async () => {
    const { calls, call } = harness();
    for (const bad of ['a.md', '/a.md', 'pages/']) {
      const res = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', paths: [bad] });
      expect(res.isError).toBe(true);
      expect(res.body.code).toBe('INVALID_PATHS_FILTER');
    }
    expect(calls.getReleaseDiff).toEqual([]);
  });

  it.each([
    ['an empty array', []],
    ['an unknown root id', ['nope/a.md']],
    ['a non-releasable root', ['scratch/a.md']],
  ])('`paths` with %s is INVALID_PATHS_FILTER', async (_label, paths) => {
    const { call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', paths });
    expect(res.body.code).toBe('INVALID_PATHS_FILTER');
    expect(res.body.error).toContain('releasable roots: [pages, plugins]');
  });

  it('checks pagination before the filters, and every single-filter refusal before conflicts (2.1.11)', async () => {
    const { call } = harness();
    const paging = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', limit: -1, roots: [] });
    expect(paging.body.code).toBe('INVALID_PAGINATION');
    const empty = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', paths: [], roots: ['pages'] });
    expect(empty.body.code).toBe('INVALID_PATHS_FILTER');
    // An unknown root is a single-filter refusal, so it wins over the paths+roots conflict.
    const unknown = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', paths: ['nope/a.md'], roots: ['nope'] });
    expect(unknown.body.code).toBe('INVALID_ROOTS_FILTER');
    const conflict = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', paths: ['pages/a.md'], roots: ['pages'] });
    expect(conflict.body.code).toBe('CONFLICTING_FILTERS');
  });

  it('documents `paths` on the parameter verbatim from the tool record', () => {
    const server = createReleaseToolsServer({
      releaseService: {} as ReleaseService,
      gitService: {} as GitService,
      ws: { broadcast: () => {} } as unknown as WsEmitter,
      roots: () => ROOTS,
    });
    const tool = server.tools.find((t) => t.name === 'release_diff')!;
    const paths = (tool.inputSchema as Record<string, { description?: string }>).paths;
    expect(paths?.description).toContain(
      "Each element is a page's FULL key `<rootId>/<relPath>` and addresses exactly one page file — a directory prefix is not accepted. Mutually exclusive with `roots`, and rejected when `include` does not carry 'pages'. An empty array, an element without a root prefix, an unknown root id, or a non-releasable root is rejected.",
    );
    expect(tool.description).toContain('{ rootId, path, op, sections, size }');
    expect(paths?.description).toContain('Exactly one element enables the section window and, in light mode, the section map.');
  });
});

describe('release_diff — the section window (2.1.5)', () => {
  it.each([
    ['no paths', { sectionOffset: 0 }],
    ['two paths', { paths: ['pages/a.md', 'pages/b.md'], sectionLimit: 1 }],
  ])('[ac:ac-l3-mcp-release-diff-z-sectionoffset-a] a section window with %s is CONFLICTING_FILTERS', async (_label, extra) => {
    const { call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', ...extra });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('CONFLICTING_FILTERS');
  });

  it('a negative section window is INVALID_PAGINATION, checked before summaryOnly and the filters', async () => {
    const { call } = harness();
    for (const w of [{ sectionOffset: -1 }, { sectionLimit: -2 }]) {
      const res = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', summaryOnly: true, roots: [], ...w });
      expect(res.body.code).toBe('INVALID_PAGINATION');
    }
  });

  it('one path accepts the window and reports total.sections', async () => {
    const { call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', paths: ['pages/gone.md'], sectionOffset: 0, sectionLimit: 1 });
    expect(res.isError).toBeFalsy();
    expect(res.body.total).toHaveProperty('sections');
  });

  it('documents the window parameters and the four-rung ladder', () => {
    const server = createReleaseToolsServer({
      releaseService: {} as ReleaseService,
      gitService: {} as GitService,
      ws: { broadcast: () => {} } as unknown as WsEmitter,
      roots: () => ROOTS,
    });
    const tool = server.tools.find((t) => t.name === 'release_diff')!;
    const schema = tool.inputSchema as Record<string, { description?: string }>;
    expect(schema.sectionOffset?.description).toContain('Requires exactly one element in `paths`');
    expect(schema.sectionLimit?.description).toContain('section by section');
    expect(schema.summaryOnly?.description).toContain('`sectionMap`');
    expect(tool.description).toContain('`sectionLimit: 1` reads it section by section');
  });
});

/**
 * 2.1.11 — the diff window's literal matrix and the `slugs` filter. Both live in
 * `releaseDiffOperation`; asserted here through the tool because the tool is a
 * thin call into it.
 */
describe('release_diff — 2.1.11 literal matrix', () => {
  it('[ac:release-diff-initial-equivalence] treats "initial", "null" and null as the same empty state', async () => {
    for (const from of [null, 'null', 'initial']) {
      const { calls, call } = harness();
      const res = await call({ fromIdOrName: from, toIdOrName: 'v2' });
      expect(res.isError).toBe(false);
      expect(calls.getReleaseDiff).toEqual([[null, 'v2']]);
      // No left snapshot is resolved for the empty state.
      expect(calls.getReleaseSnapshot).toEqual(['v2']);
    }
  });

  it.each([
    [{ fromIdOrName: null, toIdOrName: 'current' }],
    [{ fromIdOrName: 'null', toIdOrName: 'current' }],
    [{ fromIdOrName: 'initial', toIdOrName: 'current' }],
    [{ fromIdOrName: 'current', toIdOrName: 'v2' }],
    [{ fromIdOrName: 'v1', toIdOrName: 'initial' }],
    [{ fromIdOrName: 'v1', toIdOrName: 'null' }],
  ])('refuses %o with INVALID_DIFF_RANGE before any lookup', async (args) => {
    const { calls, call } = harness();
    const res = await call(args);
    expect(res.body.code).toBe('INVALID_DIFF_RANGE');
    expect(calls.getReleaseDiff).toEqual([]);
    expect(calls.getUnreleasedDiff).toEqual([]);
    expect(calls.getReleaseSnapshot).toEqual([]);
  });

  it('validates filters before the literals — CONFLICTING_FILTERS wins with toIdOrName: "current"', async () => {
    const { call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'current', include: ['pages'], entityTypes: ['endpoint'] });
    expect(res.body.code).toBe('CONFLICTING_FILTERS');
  });
});

describe('release_diff — 2.1.11 `slugs` filter', () => {
  it('narrows entities[] to the named slug before `total` is counted', async () => {
    const { call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'current', entityTypes: ['endpoint'], slugs: ['ep-new'] });
    expect(res.isError).toBe(false);
    expect(res.body.entities.map((e: { slug: string }) => e.slug)).toEqual(['ep-new']);
    expect(res.body.total.entities).toBe(1);
  });

  it('answers an unchanged or absent slug with an empty list, not an error', async () => {
    const { call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'current', entityTypes: ['endpoint'], slugs: ['nope'] });
    expect(res.isError).toBe(false);
    expect(res.body.entities).toEqual([]);
    expect(res.body.total.entities).toBe(0);
  });

  it('narrows the light map too', async () => {
    const { call } = harness();
    const res = await call({
      fromIdOrName: 'v1',
      toIdOrName: 'current',
      entityTypes: ['endpoint'],
      slugs: ['ep-kept'],
      summaryOnly: true,
    });
    expect(res.body.entities.map((e: { slug: string }) => e.slug)).toEqual(['ep-kept']);
  });

  it('combines with `paths` — the pages dimension is untouched', async () => {
    const { call } = harness();
    const res = await call({
      fromIdOrName: 'v1',
      toIdOrName: 'current',
      entityTypes: ['endpoint'],
      slugs: ['ep-new'],
      paths: ['pages/new.md'],
    });
    expect(res.isError).toBe(false);
  });

  it.each([
    [{ slugs: [] }, 'INVALID_SLUGS_FILTER'],
    [{ entityTypes: ['endpoint'], slugs: ['a', '', 'b'] }, 'INVALID_SLUGS_FILTER'],
    // A single-filter refusal outranks the combination refusal.
    [{ slugs: [], include: ['pages'] }, 'INVALID_SLUGS_FILTER'],
    [{ slugs: ['a'] }, 'CONFLICTING_FILTERS'],
    [{ entityTypes: ['endpoint', 'dto'], slugs: ['a'] }, 'CONFLICTING_FILTERS'],
    [{ include: ['pages'], slugs: ['a'] }, 'CONFLICTING_FILTERS'],
  ])('refuses %o with %s', async (extra, code) => {
    const { call } = harness();
    const res = await call({ fromIdOrName: 'v1', toIdOrName: 'v2', ...extra });
    expect(res.body.code).toBe(code);
  });
});

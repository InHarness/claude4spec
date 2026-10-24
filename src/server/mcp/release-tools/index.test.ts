import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createReleaseToolsServer } from './index.js';
import { ReleaseService } from '../../services/release.js';
import type { GitService } from '../../services/git.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import type { RawDelta, FileDiff, SpecSnapshot } from '../../../shared/entities.js';
import { runMigrations } from '../../db/migrate.js';
import type { PluginHost } from '../../core/plugin-host/types.js';
import type { FileSerializer } from '../../services/file-serializer.js';
import type { VersionService } from '../../services/versions.js';
import type { FileVersionService } from '../../services/file-version.js';
import type { RawEntityReader } from '../../discovery/raw-entity-reader.js';
import type { TagsService } from '../../services/tags.js';
import type { PagesService } from '../../services/pages.js';
import { RELEASE_TOOL_RECORDS } from '../../../../tests/helpers/release-tool-records.js';
import { expectToolMatchesToolRecord } from '../../../../tests/helpers/write-tool-records.js';
import { expectOperationMatchesRecord } from '../../../../tests/helpers/operation-records.js';

/**
 * `release_diff`'s SECOND ENGINE — `toReleaseName: "current"`.
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

// 2.1.8: `deps.roots()` yields the PAGE roots of the registry (every page root is
// releasable; system roots such as `plans` are not page roots).
const ROOTS = [{ id: 'pages' }, { id: 'plugins' }];

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
    // 2.1.11: the operation resolves each name to an id before the id-taking
    // readers run. The stand-in id IS the name, so the recorded calls read as names.
    resolveReleaseId: (name: string) => name,
    getReleaseSnapshot: (releaseId: unknown) => {
      calls.getReleaseSnapshot.push(releaseId);
      // A DATABASE THAT ALREADY HOLDS a release called `current` — the shadowing
      // case the resolution order exists to rule out.
      return releaseId === 'current'
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
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'current' });

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
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'current' });

    expect(res.body.to).toEqual({ id: null, name: 'current' });
    // `from` is still resolved by name; `current` never is.
    expect(calls.getReleaseSnapshot).toEqual(['v1']);
  });

  it('reports `to.id: null` — the only signal that the after side is not frozen', async () => {
    const { call } = harness();
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'current' });
    expect(res.body.to).toEqual({ id: null, name: 'current' });
    expect(res.body.from).toEqual({ id: 1, name: 'v1' });
  });

  it('keeps a numeric `to.id` on the ordinary two-release branch', async () => {
    const { calls, call } = harness();
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'v2' });
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
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'current', summaryOnly: true });
    const entities = res.body.entities as Array<Record<string, unknown>>;
    expect(entities.find((e) => e.slug === 'dto-gone')).toMatchObject({ op: 'delete' });
    expect(res.body.pages).toContainEqual(expect.objectContaining({ rootId: 'pages', path: 'pages/gone.md', op: 'delete' }));
  });

  it('summaryOnly returns the FULL identity map on this branch too, ignoring limit', async () => {
    const { call } = harness();
    const res = await call({
      fromReleaseName: 'v1',
      toReleaseName: 'current',
      summaryOnly: true,
      limit: 1,
    });
    expect(res.body.total).toEqual({ entities: 3, pages: 2 });
    expect(res.body.entities).toHaveLength(3);
    expect(res.body.pages).toHaveLength(2);
  });

  it('passes `roots` through to the unreleased engine untouched', async () => {
    const { calls, call } = harness();
    await call({ fromReleaseName: 'v1', toReleaseName: 'current', roots: ['pages'] });
    expect(calls.getUnreleasedDiff).toEqual(['v1']);
    expect(calls.unreleasedOpts).toEqual([{ roots: ['pages'], paths: undefined }]);
  });
});

describe('release_diff — INVALID_DIFF_RANGE', () => {
  it('refuses `from: null` together with `to: "current"` — from nothing to the working tree', async () => {
    const { calls, call } = harness();
    const res = await call({ fromReleaseName: null, toReleaseName: 'current' });

    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('INVALID_DIFF_RANGE');
    // Refused BEFORE any engine ran.
    expect(calls.getUnreleasedDiff).toEqual([]);
    expect(calls.getReleaseDiff).toEqual([]);
  });

  it('still allows `from: null` against a real release (the initial brief)', async () => {
    const { calls, call } = harness();
    const res = await call({ fromReleaseName: null, toReleaseName: 'v2' });
    expect(res.isError).toBe(false);
    expect(calls.getReleaseDiff).toEqual([[null, 'v2']]);
  });

  /** Pagination is validated ahead of the branch — the 0.1.71 rule, unchanged. */
  it('reports INVALID_PAGINATION before it ever looks at the range', async () => {
    const { calls, call } = harness();
    const res = await call({ fromReleaseName: null, toReleaseName: 'current', limit: -1 });
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
    expect(tool.description).toContain('toReleaseName: "current"');
    expect(tool.description).toContain('does not reproduce later');
    const to = (tool.inputSchema as Record<string, { description?: string }>).toReleaseName;
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
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', paths: ['plugins/modules/x.md'] });
    expect(res.isError).toBe(false);
    expect(calls.releaseOpts).toEqual([{ roots: undefined, paths: ['plugins/modules/x.md'] }]);
  });

  it('passes `paths` through to the unreleased engine too', async () => {
    const { calls, call } = harness();
    await call({ fromReleaseName: 'v1', toReleaseName: 'current', paths: ['pages/a.md'] });
    expect(calls.unreleasedOpts).toEqual([{ roots: undefined, paths: ['pages/a.md'] }]);
  });

  it('[ac:ac-release-diff-wywolany-z-paths-i-roots] `paths` together with `roots` is CONFLICTING_FILTERS', async () => {
    const { calls, call } = harness();
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', paths: ['pages/a.md'], roots: ['pages'] });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('CONFLICTING_FILTERS');
    expect(calls.getReleaseDiff).toEqual([]);
  });

  it("`paths` without 'pages' in include is CONFLICTING_FILTERS — the mirror of entityTypes without 'entities'", async () => {
    const { call } = harness();
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', include: ['entities'], paths: ['pages/a.md'] });
    expect(res.body.code).toBe('CONFLICTING_FILTERS');
    expect(res.body.error).toContain("'pages'");
  });

  it('[ac:ac-release-diff-wywolany-z-roots-jest-od] `roots: []` is INVALID_ROOTS_FILTER', async () => {
    const { calls, call } = harness();
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', roots: [] });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('INVALID_ROOTS_FILTER');
    expect(calls.getReleaseDiff).toEqual([]);
  });

  it.each([
    ['an unknown root', ['nope']],
    ['a system root id', ['plans']],
    // 2.1.8: the `entities` root is served by the entity axis, not by `roots`;
    // `releases` carries release metadata — neither is a `kind: pages` root.
    ['the entities system root', ['entities']],
    ['the releases system root', ['releases']],
  ])('`roots` with %s is INVALID_ROOTS_FILTER naming the page roots', async (_label, roots) => {
    const { calls, call } = harness();
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', roots });
    expect(res.body.code).toBe('INVALID_ROOTS_FILTER');
    expect(res.body.error).toContain(`roots: '${roots[0]}' is not a page root (page roots: [pages, plugins])`);
    expect(res.body.hint).toBe('page roots: [pages, plugins]');
    expect(calls.getReleaseDiff).toEqual([]);
  });

  it("2.1.8: `release_diff({ roots: ['plans'] })` is INVALID_ROOTS_FILTER listing the page roots — a system root is not a page root", async () => {
    const { calls, call } = harness();
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'current', roots: ['plans'] });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('INVALID_ROOTS_FILTER');
    expect(res.body.error).toBe("roots: 'plans' is not a page root (page roots: [pages, plugins])");
    expect(calls.getReleaseDiff).toEqual([]);
    expect(calls.getUnreleasedDiff).toEqual([]);
  });

  it('[ac:ac-release-diff-z-elementem-paths-pozbaw] an element without a root prefix is INVALID_PATHS_FILTER', async () => {
    const { calls, call } = harness();
    for (const bad of ['a.md', '/a.md', 'pages/']) {
      const res = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', paths: [bad] });
      expect(res.isError).toBe(true);
      expect(res.body.code).toBe('INVALID_PATHS_FILTER');
    }
    expect(calls.getReleaseDiff).toEqual([]);
  });

  it.each([
    ['an empty array', []],
    ['an unknown root id', ['nope/a.md']],
    ['a system root id', ['plans/a.md']],
    ['the entities system root', ['entities/endpoint/x.json']],
    ['the releases system root', ['releases/v1.json']],
  ])('`paths` with %s is INVALID_PATHS_FILTER', async (_label, paths) => {
    const { call } = harness();
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', paths });
    expect(res.body.code).toBe('INVALID_PATHS_FILTER');
    expect(res.body.error).toContain('page roots: [pages, plugins]');
  });

  it('checks pagination before the filters, and every single-filter refusal before conflicts (2.1.11)', async () => {
    const { call } = harness();
    const paging = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', limit: -1, roots: [] });
    expect(paging.body.code).toBe('INVALID_PAGINATION');
    const empty = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', paths: [], roots: ['pages'] });
    expect(empty.body.code).toBe('INVALID_PATHS_FILTER');
    // An unknown root is a single-filter refusal, so it wins over the paths+roots conflict.
    const unknown = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', paths: ['nope/a.md'], roots: ['nope'] });
    expect(unknown.body.code).toBe('INVALID_ROOTS_FILTER');
    const conflict = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', paths: ['pages/a.md'], roots: ['pages'] });
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
      "Each element is a page's FULL key `<rootId>/<relPath>` and addresses exactly one page file — a directory prefix is not accepted. Mutually exclusive with `roots`, and rejected when `include` does not carry 'pages'. An empty array, an element without a root prefix, an unknown root id, or a root that is not a page root is rejected.",
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
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', ...extra });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('CONFLICTING_FILTERS');
  });

  it('a negative section window is INVALID_PAGINATION, checked before summaryOnly and the filters', async () => {
    const { call } = harness();
    for (const w of [{ sectionOffset: -1 }, { sectionLimit: -2 }]) {
      const res = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', summaryOnly: true, roots: [], ...w });
      expect(res.body.code).toBe('INVALID_PAGINATION');
    }
  });

  it('one path accepts the window and reports total.sections', async () => {
    const { call } = harness();
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', paths: ['pages/gone.md'], sectionOffset: 0, sectionLimit: 1 });
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
      const res = await call({ fromReleaseName: from, toReleaseName: 'v2' });
      expect(res.isError).toBe(false);
      expect(calls.getReleaseDiff).toEqual([[null, 'v2']]);
      // No left snapshot is resolved for the empty state.
      expect(calls.getReleaseSnapshot).toEqual(['v2']);
    }
  });

  it.each([
    [{ fromReleaseName: null, toReleaseName: 'current' }],
    [{ fromReleaseName: 'null', toReleaseName: 'current' }],
    [{ fromReleaseName: 'initial', toReleaseName: 'current' }],
    [{ fromReleaseName: 'current', toReleaseName: 'v2' }],
    [{ fromReleaseName: 'v1', toReleaseName: 'initial' }],
    [{ fromReleaseName: 'v1', toReleaseName: 'null' }],
  ])('refuses %o with INVALID_DIFF_RANGE before any lookup', async (args) => {
    const { calls, call } = harness();
    const res = await call(args);
    expect(res.body.code).toBe('INVALID_DIFF_RANGE');
    expect(calls.getReleaseDiff).toEqual([]);
    expect(calls.getUnreleasedDiff).toEqual([]);
    expect(calls.getReleaseSnapshot).toEqual([]);
  });

  it('validates filters before the literals — CONFLICTING_FILTERS wins with toReleaseName: "current"', async () => {
    const { call } = harness();
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'current', include: ['pages'], entityTypes: ['endpoint'] });
    expect(res.body.code).toBe('CONFLICTING_FILTERS');
  });
});

describe('release_diff — 2.1.11 `slugs` filter', () => {
  it('narrows entities[] to the named slug before `total` is counted', async () => {
    const { call } = harness();
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'current', entityTypes: ['endpoint'], slugs: ['ep-new'] });
    expect(res.isError).toBe(false);
    expect(res.body.entities.map((e: { slug: string }) => e.slug)).toEqual(['ep-new']);
    expect(res.body.total.entities).toBe(1);
  });

  it('answers an unchanged or absent slug with an empty list, not an error', async () => {
    const { call } = harness();
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'current', entityTypes: ['endpoint'], slugs: ['nope'] });
    expect(res.isError).toBe(false);
    expect(res.body.entities).toEqual([]);
    expect(res.body.total.entities).toBe(0);
  });

  it('narrows the light map too', async () => {
    const { call } = harness();
    const res = await call({
      fromReleaseName: 'v1',
      toReleaseName: 'current',
      entityTypes: ['endpoint'],
      slugs: ['ep-kept'],
      summaryOnly: true,
    });
    expect(res.body.entities.map((e: { slug: string }) => e.slug)).toEqual(['ep-kept']);
  });

  it('combines with `paths` — the pages dimension is untouched', async () => {
    const { call } = harness();
    const res = await call({
      fromReleaseName: 'v1',
      toReleaseName: 'current',
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
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'v2', ...extra });
    expect(res.body.code).toBe(code);
  });
});

// ─── 2.1.26 — the five `mcp-tool` records and the six M17 `spec-operation` records ───

/**
 * A real `ReleaseService` over an in-memory database, for the record tests of the
 * writers and the list: what the records' `logic` states (trim, refusal codes,
 * actor `agent`, the assignment, camelCase counters, `gitSync`, the order of the
 * release axis) is the service's, reached through the tool. The git service and
 * the emitter are spies.
 */
function liveHarness(opts: { commit?: unknown; pull?: unknown } = {}) {
  const db = new Database(':memory:');
  runMigrations(db);
  const releaseService = new ReleaseService(
    db,
    { getEntity: () => null, listEntities: () => [] } as unknown as PluginHost,
    {} as unknown as VersionService,
    { assignToRelease: () => {} } as unknown as FileVersionService,
    { version: 'v1' } as unknown as FileSerializer,
    {} as unknown as RawEntityReader,
    {} as unknown as TagsService,
    {} as unknown as PagesService,
  );
  const gitCalls: Array<{ kind: string; releaseId: number }> = [];
  const gitService = {
    commitOnRelease: async (r: { id: number }) => {
      gitCalls.push({ kind: 'commitOnRelease', releaseId: r.id });
      return opts.commit === undefined ? { status: 'committed', branch: 'main' } : opts.commit;
    },
    commitPull: async (r: { id: number }) => {
      gitCalls.push({ kind: 'commitPull', releaseId: r.id });
      return opts.pull === undefined ? { status: 'committed', branch: 'main' } : opts.pull;
    },
  } as unknown as GitService;
  releaseService.setGitService(gitService);
  const broadcasts: Array<Record<string, unknown>> = [];
  const server = createReleaseToolsServer({
    releaseService,
    gitService,
    ws: { broadcast: (e: Record<string, unknown>) => broadcasts.push(e) } as unknown as WsEmitter,
    roots: () => ROOTS,
  });
  const call = async (tool: string, args: Record<string, unknown>) => {
    const t = server.tools.find((x) => x.name === tool)!;
    const res = (await t.handler(args, {} as never)) as { isError?: boolean; content: Array<{ text: string }> };
    return { isError: res.isError === true, body: JSON.parse(res.content[0]!.text) as any };
  };
  const unreleased = (slug: string) =>
    db
      .prepare(`INSERT INTO entity_version (entity_type, entity_slug, version, data, changed_by) VALUES ('endpoint', ?, 1, '{}', 'user')`)
      .run(slug);
  const releaseIdOf = (slug: string) =>
    (db.prepare(`SELECT release_id AS r FROM entity_version WHERE entity_slug = ?`).get(slug) as { r: number | null }).r;
  return { db, server, call, gitCalls, broadcasts, unreleased, releaseIdOf };
}

const toolOf = (name: string) =>
  createReleaseToolsServer({
    releaseService: {} as ReleaseService,
    gitService: {} as GitService,
    ws: { broadcast: () => {} } as unknown as WsEmitter,
    roots: () => ROOTS,
  }).tools.find((t) => t.name === name);

describe('release-tools — the 2.1.26 mcp-tool records', () => {
  it('[entity:release-tools-release-create] release_create: name, description and both required parameters as the record states them, no hints; trims, refuses with VALIDATION / RELEASE_NAME_RESERVED / RELEASE_DESCRIPTION_REQUIRED / RELEASE_DESCRIPTION_TOO_LONG / RELEASE_NAME_CONFLICT / RELEASE_SLUG_CONFLICT, records actor agent, assigns every unreleased version and answers camelCase countBreakdown with gitSync', async () => {
    expectToolMatchesToolRecord(toolOf('release_create'), RELEASE_TOOL_RECORDS['release-tools-release-create']!);

    const h = liveHarness();
    h.unreleased('ep-a');
    const res = await h.call('release_create', { name: '  0.2.33  ', description: '  Kontrakty wire jako encje  ' });
    expect(res.isError).toBe(false);
    expect(res.body).toMatchObject({
      name: '0.2.33',
      description: 'Kontrakty wire jako encje',
      createdBy: 'agent',
      countBreakdown: { entities: { endpoint: 1 }, pages: 0, total: 1 },
      gitSync: { status: 'committed', branch: 'main' },
    });
    expect(Object.keys(res.body).sort()).toEqual(
      ['countBreakdown', 'createdAt', 'createdBy', 'description', 'gitSync', 'id', 'name'].sort(),
    );
    expect(res.body).not.toHaveProperty('count_breakdown');
    // Every unreleased version went into the new release, in its transaction.
    expect(h.releaseIdOf('ep-a')).toBe(res.body.id);
    // After the transaction: the broadcast, then the git commit of THIS release.
    expect(h.broadcasts).toEqual([{ kind: 'release:created', releaseId: res.body.id, name: '0.2.33' }]);
    expect(h.gitCalls).toEqual([{ kind: 'commitOnRelease', releaseId: res.body.id }]);

    const refusals: Array<[Record<string, unknown>, string]> = [
      [{ name: '   ', description: 'x' }, 'VALIDATION'],
      [{ name: 'current', description: 'x' }, 'RELEASE_NAME_RESERVED'],
      [{ name: 'initial', description: 'x' }, 'RELEASE_NAME_RESERVED'],
      [{ name: 'null', description: 'x' }, 'RELEASE_NAME_RESERVED'],
      [{ name: 'v9', description: '   ' }, 'RELEASE_DESCRIPTION_REQUIRED'],
      [{ name: 'v9', description: 'x'.repeat(501) }, 'RELEASE_DESCRIPTION_TOO_LONG'],
      [{ name: '0.2.33', description: 'again' }, 'RELEASE_NAME_CONFLICT'],
      // Another name, the same slug as `0.2.33`.
      [{ name: '0-2-33', description: 'x' }, 'RELEASE_SLUG_CONFLICT'],
    ];
    for (const [args, code] of refusals) {
      const r = await h.call('release_create', args);
      expect(r.isError, code).toBe(true);
      expect(r.body.code).toBe(code);
    }
    expect((h.db.prepare('SELECT COUNT(*) AS n FROM spec_release').get() as { n: number }).n).toBe(1);
  });

  it('[entity:release-tools-release-create] gitSync is null when the commit did not run (git off, no repository)', async () => {
    const h = liveHarness({ commit: null });
    const res = await h.call('release_create', { name: 'v1', description: 'first' });
    expect(res.isError).toBe(false);
    expect(res.body.gitSync).toBeNull();
    expect(res.body.countBreakdown).toEqual({ entities: {}, pages: 0, total: 0 });
  });

  it('[entity:release-tools-release-list] release_list: optional limit / offset as the record states them, no hints; default window 5 from 0 with no upper bound, newest first by created_at then id, `{ releases, total }` with total before the window, negative → INVALID_PAGINATION', async () => {
    expectToolMatchesToolRecord(toolOf('release_list'), RELEASE_TOOL_RECORDS['release-tools-release-list']!);

    const h = liveHarness();
    const insert = h.db.prepare(
      `INSERT INTO spec_release (name, slug, description, created_by, created_at) VALUES (?, ?, 'd', 'user', ?)`,
    );
    // r1..r6 a minute apart, plus `tie` sharing r6's timestamp with a higher id.
    for (let i = 1; i <= 6; i++) insert.run(`r${i}`, `r${i}`, `2026-08-0${i}T00:00:00.000Z`);
    insert.run('tie', 'tie', '2026-08-06T00:00:00.000Z');

    const first = await h.call('release_list', {});
    expect(first.isError).toBe(false);
    expect(first.body.total).toBe(7);
    expect(first.body.releases.map((r: { name: string }) => r.name)).toEqual(['tie', 'r6', 'r5', 'r4', 'r3']);
    expect(Object.keys(first.body.releases[0]).sort()).toEqual(['createdAt', 'createdBy', 'description', 'id', 'name']);

    const rest = await h.call('release_list', { offset: 5 });
    expect(rest.body.releases.map((r: { name: string }) => r.name)).toEqual(['r2', 'r1']);
    const all = await h.call('release_list', { limit: 1000 });
    expect(all.body.releases).toHaveLength(7);

    for (const bad of [{ limit: -1 }, { offset: -1 }]) {
      const r = await h.call('release_list', bad);
      expect(r.isError).toBe(true);
      expect(r.body.code).toBe('INVALID_PAGINATION');
    }
  });

  it('[entity:release-tools-release-show] release_show: releaseName required, include as enum(pages, entities)[], entityTypes, limit, offset as the record states them, no hints; filter refusals, RELEASE_NOT_FOUND for an unknown name or a literal, identity-only rows windowed by one window per list', async () => {
    const tool = toolOf('release_show');
    expectToolMatchesToolRecord(tool, RELEASE_TOOL_RECORDS['release-tools-release-show']!);

    const live = liveHarness();
    for (const name of ['nope', 'current', 'initial', 'null']) {
      const r = await live.call('release_show', { releaseName: name });
      expect(r.isError, name).toBe(true);
      expect(r.body.code).toBe('RELEASE_NOT_FOUND');
    }

    const server = createReleaseToolsServer({
      releaseService: {
        resolveReleaseId: (name: string) => name,
        getReleaseSnapshot: () => V1_SNAPSHOT,
      } as unknown as ReleaseService,
      gitService: {} as GitService,
      ws: { broadcast: () => {} } as unknown as WsEmitter,
      roots: () => ROOTS,
    });
    const show = server.tools.find((t) => t.name === 'release_show')!;
    const call = async (args: Record<string, unknown>) => {
      const res = (await show.handler(args, {} as never)) as { isError?: boolean; content: Array<{ text: string }> };
      return { isError: res.isError === true, body: JSON.parse(res.content[0]!.text) as any };
    };
    for (const [args, code] of [
      [{ include: [] }, 'INVALID_INCLUDE_FILTER'],
      [{ entityTypes: [] }, 'INVALID_ENTITY_TYPES_FILTER'],
      [{ include: ['pages'], entityTypes: ['dto'] }, 'CONFLICTING_FILTERS'],
      [{ limit: -1 }, 'INVALID_PAGINATION'],
      [{ offset: -2 }, 'INVALID_PAGINATION'],
    ] as Array<[Record<string, unknown>, string]>) {
      const r = await call({ releaseName: 'v1', ...args });
      expect(r.body.code).toBe(code);
    }

    const full = await call({ releaseName: 'v1' });
    expect(full.body.release).toEqual({
      id: 1,
      name: 'v1',
      description: '',
      created_by: 'agent',
      created_at: '2026-09-01T00:00:00.000Z',
    });
    expect(full.body.total).toEqual({ entities: 2, pages: 1 });
    expect(full.body.entities).toEqual([
      { type: 'endpoint', slug: 'ep-kept', name: 'Kept (old)' },
      { type: 'dto', slug: 'dto-gone', name: 'Gone' },
    ]);
    expect(full.body.pages).toEqual([{ path: 'pages/gone.md' }]);
    // The same window cuts both lists; `total` is counted before it.
    const windowed = await call({ releaseName: 'v1', limit: 1, offset: 1 });
    expect(windowed.body.entities).toEqual([{ type: 'dto', slug: 'dto-gone', name: 'Gone' }]);
    expect(windowed.body.pages).toEqual([]);
    expect(windowed.body.total).toEqual({ entities: 2, pages: 1 });
    // `include` keeps `total` keys and lists in lock-step.
    const pagesOnly = await call({ releaseName: 'v1', include: ['pages'] });
    expect(pagesOnly.body.total).toEqual({ pages: 1 });
    expect(pagesOnly.body).not.toHaveProperty('entities');
  });

  it('[entity:release-tools-release-diff] release_diff: fromReleaseName as string | null, toReleaseName, include as enum(pages, entities)[] and the filter and window parameters as the record states them, no hints; window refusals first, empty filters and literals refused, `current` against the unassigned state with `to.id: null`, entities and pages windowed independently after filters', async () => {
    expectToolMatchesToolRecord(toolOf('release_diff'), RELEASE_TOOL_RECORDS['release-tools-release-diff']!);

    const { calls, call } = harness();
    for (const [args, code] of [
      [{ fromReleaseName: 'v1', toReleaseName: 'v2', include: [] }, 'INVALID_INCLUDE_FILTER'],
      [{ fromReleaseName: 'v1', toReleaseName: 'v2', entityTypes: [] }, 'INVALID_ENTITY_TYPES_FILTER'],
      [{ fromReleaseName: 'v1', toReleaseName: 'v2', slugs: [] }, 'INVALID_SLUGS_FILTER'],
      [{ fromReleaseName: 'v1', toReleaseName: 'v2', roots: [] }, 'INVALID_ROOTS_FILTER'],
      [{ fromReleaseName: 'v1', toReleaseName: 'v2', paths: [] }, 'INVALID_PATHS_FILTER'],
      [{ fromReleaseName: 'v1', toReleaseName: 'v2', include: ['pages'], entityTypes: ['dto'] }, 'CONFLICTING_FILTERS'],
      [{ fromReleaseName: 'v1', toReleaseName: 'v2', offset: -1, include: [] }, 'INVALID_PAGINATION'],
      [{ fromReleaseName: 'current', toReleaseName: 'v2' }, 'INVALID_DIFF_RANGE'],
      [{ fromReleaseName: 'initial', toReleaseName: 'current' }, 'INVALID_DIFF_RANGE'],
    ] as Array<[Record<string, unknown>, string]>) {
      const r = await call(args);
      expect(r.isError).toBe(true);
      expect(r.body.code).toBe(code);
    }
    expect(calls.getReleaseDiff).toEqual([]);
    expect(calls.getUnreleasedDiff).toEqual([]);

    // `current` as `to`: the delta from the unassigned state, `to.id: null`;
    // the window (here 1 from 0) cuts entities and pages independently, `total` before it.
    const res = await call({ fromReleaseName: 'v1', toReleaseName: 'current', limit: 1 });
    expect(res.isError).toBe(false);
    expect(calls.getUnreleasedDiff).toEqual(['v1']);
    expect(res.body.to).toEqual({ id: null, name: 'current' });
    expect(res.body.total).toEqual({ entities: 3, pages: 2 });
    expect(res.body.entities).toHaveLength(1);
    expect(res.body.pages).toHaveLength(1);

    // An unknown name is RELEASE_NOT_FOUND (the real name lookup).
    const live = liveHarness();
    const missing = await live.call('release_diff', { fromReleaseName: 'nope', toReleaseName: 'current' });
    expect(missing.body.code).toBe('RELEASE_NOT_FOUND');
  });

  it('[entity:release-tools-release-update] release_update: releaseName required and the optional name / description / assignUnreleased as the record states them, no hints; RELEASE_NOT_FOUND before RELEASE_FROZEN, rename checks, camelCase countBreakdown, gitSync null without assignment', async () => {
    expectToolMatchesToolRecord(toolOf('release_update'), RELEASE_TOOL_RECORDS['release-tools-release-update']!);

    const h = liveHarness();
    await h.call('release_create', { name: 'v1', description: 'first' });
    const v2 = await h.call('release_create', { name: 'v2', description: 'second' });
    h.gitCalls.length = 0;
    h.broadcasts.length = 0;

    // A literal or an unknown name → RELEASE_NOT_FOUND; a frozen (older) release → RELEASE_FROZEN.
    for (const name of ['current', 'nope']) {
      expect((await h.call('release_update', { releaseName: name, description: 'x' })).body.code).toBe('RELEASE_NOT_FOUND');
    }
    expect((await h.call('release_update', { releaseName: 'v1', description: 'x' })).body.code).toBe('RELEASE_FROZEN');

    for (const [args, code] of [
      [{ name: '  ' }, 'VALIDATION'],
      [{ name: 'initial' }, 'RELEASE_NAME_RESERVED'],
      [{ name: 'v1' }, 'RELEASE_NAME_CONFLICT'],
      [{ name: 'V1' }, 'RELEASE_SLUG_CONFLICT'],
      [{ description: '  ' }, 'RELEASE_DESCRIPTION_REQUIRED'],
      [{ description: 'y'.repeat(501) }, 'RELEASE_DESCRIPTION_TOO_LONG'],
    ] as Array<[Record<string, unknown>, string]>) {
      const r = await h.call('release_update', { releaseName: 'v2', ...args });
      expect(r.isError, code).toBe(true);
      expect(r.body.code).toBe(code);
    }

    const renamed = await h.call('release_update', { releaseName: 'v2', name: ' v2.1 ', description: 'sharper' });
    expect(renamed.isError).toBe(false);
    expect(renamed.body).toMatchObject({ id: v2.body.id, name: 'v2.1', description: 'sharper', gitSync: null });
    expect(renamed.body.countBreakdown).toEqual({ entities: {}, pages: 0, total: 0 });
    expect(renamed.body).not.toHaveProperty('count_breakdown');
    // 2.1.47: `acceptedShadow` is REST dto `release` only — not in this tool's record.
    expect(Object.keys(renamed.body).sort()).toEqual(
      ['countBreakdown', 'createdAt', 'createdBy', 'description', 'gitSync', 'id', 'name'].sort(),
    );
    // Without `assignUnreleased` nothing is committed.
    expect(h.gitCalls).toEqual([]);
    expect(h.broadcasts).toEqual([{ kind: 'release:updated', releaseId: v2.body.id, name: 'v2.1' }]);
  });

  it('[entity:release-tools-release-update] assignUnreleased: commit first, then assign the unreleased versions — unless the commit ended in an error', async () => {
    const h = liveHarness();
    await h.call('release_create', { name: 'v1', description: 'first' });
    h.unreleased('ep-late');
    h.gitCalls.length = 0;

    const res = await h.call('release_update', { releaseName: 'v1', assignUnreleased: true });
    expect(res.isError).toBe(false);
    expect(h.gitCalls).toEqual([{ kind: 'commitPull', releaseId: res.body.id }]);
    expect(res.body.gitSync).toEqual({ status: 'committed', branch: 'main' });
    expect(res.body.countBreakdown).toEqual({ entities: { endpoint: 1 }, pages: 0, total: 1 });
    expect(h.releaseIdOf('ep-late')).toBe(res.body.id);

    const failing = liveHarness({ pull: { status: 'error', message: 'boom' } });
    await failing.call('release_create', { name: 'v1', description: 'first' });
    failing.unreleased('ep-late');
    const refused = await failing.call('release_update', { releaseName: 'v1', assignUnreleased: true });
    expect(refused.isError).toBe(false);
    expect(refused.body.gitSync).toMatchObject({ status: 'error' });
    expect(failing.releaseIdOf('ep-late')).toBeNull();
  });
});

describe('release-tools — the 2.1.26 spec-operation records of M17', () => {
  const D = { kind: 'direct' } as const;
  const CLI_WRITE = "bin `c4s` jest klientem odczytu i diagnostyki; stan release'ów zmienia się przez kanały `mcp`, `rest` i `internal`";
  const ALL_DIRECT = { internal: D, cli: D, mcp: D, rest: D };
  const rendered = (slug: string) => ({ internal: [slug], mcp: [slug] });
  const registered = new Set(
    createReleaseToolsServer({
      releaseService: {} as ReleaseService,
      gitService: {} as GitService,
      ws: { broadcast: () => {} } as unknown as WsEmitter,
      roots: () => ROOTS,
    }).tools.map((t) => t.name),
  );
  const expectRenderedHere = (op: { renderings?: { internal?: readonly string[]; mcp?: readonly string[] } }) => {
    for (const r of [...(op.renderings?.internal ?? []), ...(op.renderings?.mcp ?? [])]) {
      const [server, name] = r.split('.') as [string, string];
      expect(server).toBe('release-tools');
      expect(registered.has(name), r).toBe(true);
    }
  };

  it('[entity:release-create] release_create: project, direct, internal/mcp/rest direct, cli n/a with the record\'s reason, file/db/ui-notify, not idempotent, no content input, codes VALIDATION, RELEASE_NOT_FOUND, RELEASE_NAME_CONFLICT, RELEASE_NAME_RESERVED, RELEASE_DESCRIPTION_REQUIRED, RELEASE_DESCRIPTION_TOO_LONG, rendered by release-tools · release_create', () => {
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'release_create',
        channels: { internal: D, cli: { kind: 'na', reason: CLI_WRITE }, mcp: D, rest: D },
        efekty: ['file', 'db', 'ui-notify'],
        idempotencja: false,
        opisTresci: 'n/a',
        kodyBledow: [
          'VALIDATION',
          'RELEASE_NOT_FOUND',
          'RELEASE_NAME_CONFLICT',
          'RELEASE_NAME_RESERVED',
          'RELEASE_DESCRIPTION_REQUIRED',
          'RELEASE_DESCRIPTION_TOO_LONG',
        ],
        narzedzia: rendered('release-tools-release-create'),
      },
      RELEASE_TOOL_RECORDS,
    );
    expectRenderedHere(op);
    // No input address: the subject is the whole project.
    expect(Object.keys(op.inputSchema).sort()).toEqual(['description', 'name']);
  });

  it('[entity:release-diff] release_diff: project, direct, all four channels direct, no effects, idempotent, codes VALIDATION, RELEASE_NOT_FOUND and the eight filter / range codes, rendered by release-tools · release_diff, addressed by the from / to pair', () => {
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'release_diff',
        channels: ALL_DIRECT,
        efekty: ['none'],
        idempotencja: true,
        opisTresci: 'n/a',
        kodyBledow: [
          'VALIDATION',
          'RELEASE_NOT_FOUND',
          'INVALID_INCLUDE_FILTER',
          'INVALID_ENTITY_TYPES_FILTER',
          'CONFLICTING_FILTERS',
          'INVALID_PAGINATION',
          'INVALID_DIFF_RANGE',
          'INVALID_PATHS_FILTER',
          'INVALID_ROOTS_FILTER',
          'INVALID_SLUGS_FILTER',
        ],
        narzedzia: rendered('release-tools-release-diff'),
      },
      RELEASE_TOOL_RECORDS,
    );
    expectRenderedHere(op);
    expect(op.inputSchema).toHaveProperty('fromReleaseName');
    expect(op.inputSchema).toHaveProperty('toReleaseName');
  });

  it('[entity:release-list] release_list: project, direct, all four channels direct, no effects, idempotent, codes VALIDATION, RELEASE_NOT_FOUND, INVALID_PAGINATION, rendered by release-tools · release_list, windowed by limit / offset', () => {
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'release_list',
        channels: ALL_DIRECT,
        efekty: ['none'],
        idempotencja: true,
        opisTresci: 'n/a',
        kodyBledow: ['VALIDATION', 'RELEASE_NOT_FOUND', 'INVALID_PAGINATION'],
        narzedzia: rendered('release-tools-release-list'),
      },
      RELEASE_TOOL_RECORDS,
    );
    expectRenderedHere(op);
    expect(Object.keys(op.inputSchema).sort()).toEqual(['limit', 'offset']);
  });

  it('[entity:release-show] release_show: project, direct, all four channels direct, no effects, idempotent, codes VALIDATION, RELEASE_NOT_FOUND, INVALID_INCLUDE_FILTER, INVALID_ENTITY_TYPES_FILTER, CONFLICTING_FILTERS, INVALID_PAGINATION, rendered by release-tools · release_show, addressed by releaseName', () => {
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'release_show',
        channels: ALL_DIRECT,
        efekty: ['none'],
        idempotencja: true,
        opisTresci: 'n/a',
        kodyBledow: [
          'VALIDATION',
          'RELEASE_NOT_FOUND',
          'INVALID_INCLUDE_FILTER',
          'INVALID_ENTITY_TYPES_FILTER',
          'CONFLICTING_FILTERS',
          'INVALID_PAGINATION',
        ],
        narzedzia: rendered('release-tools-release-show'),
      },
      RELEASE_TOOL_RECORDS,
    );
    expectRenderedHere(op);
    expect(op.inputSchema).toHaveProperty('releaseName');
  });

  it('[entity:release-update] release_update: project, direct, internal/mcp/rest direct, cli n/a with the record\'s reason, db/ui-notify, not idempotent, codes VALIDATION, RELEASE_NOT_FOUND, RELEASE_FROZEN, RELEASE_NAME_CONFLICT, RELEASE_NAME_RESERVED, RELEASE_DESCRIPTION_REQUIRED, RELEASE_DESCRIPTION_TOO_LONG, rendered by release-tools · release_update, addressed by releaseName', () => {
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'release_update',
        channels: { internal: D, cli: { kind: 'na', reason: CLI_WRITE }, mcp: D, rest: D },
        efekty: ['db', 'ui-notify'],
        idempotencja: false,
        opisTresci: 'n/a',
        kodyBledow: [
          'VALIDATION',
          'RELEASE_NOT_FOUND',
          'RELEASE_FROZEN',
          'RELEASE_NAME_CONFLICT',
          'RELEASE_NAME_RESERVED',
          'RELEASE_DESCRIPTION_REQUIRED',
          'RELEASE_DESCRIPTION_TOO_LONG',
        ],
        narzedzia: rendered('release-tools-release-update'),
      },
      RELEASE_TOOL_RECORDS,
    );
    expectRenderedHere(op);
    expect(op.inputSchema).toHaveProperty('releaseName');
  });

  it('[entity:release-restore] release_restore: project, human-mediated, internal/cli/mcp n/a with the records\' reasons, rest direct, file/db, idempotent, no content input, code RELEASE_NOT_FOUND, no renderings, addressed by releaseName — and no release-tools tool carries it', () => {
    const userInitiated =
      'user-initiated: operacja nadpisuje bieżącą specyfikację cudzą, zamrożoną wersją, więc jej wyzwolenie samo w sobie jest decyzją (przegląd otwarty)';
    const op = expectOperationMatchesRecord(
      {
        nazwa: 'release_restore',
        mediacja: 'human-mediated',
        channels: {
          internal: { kind: 'na', reason: userInitiated },
          cli: { kind: 'na', reason: userInitiated },
          mcp: {
            kind: 'na',
            reason:
              "narzędzie agentowe restore'u świadomie nie istnieje: nie było use case'u, który uzasadniałby oddanie tej decyzji agentowi (przegląd otwarty)",
          },
          rest: D,
        },
        efekty: ['file', 'db'],
        idempotencja: true,
        opisTresci: 'n/a',
        kodyBledow: ['RELEASE_NOT_FOUND'],
        narzedzia: {},
      },
      {},
    );
    expect(op.opClass).toBe('write');
    expect(Object.keys(op.inputSchema)).toEqual(['releaseName']);
    expect(registered.has('release_restore')).toBe(false);
  });
});

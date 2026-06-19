import { describe, it, expect } from 'vitest';
import { DEFAULT_PAGE_LIMIT, projectReleaseDiff, projectSpecSnapshot } from './projection.js';
import { resolvePagination } from './index.js';
import { DomainError } from '../../services/tags.js';
import type { RawDelta, RawDeltaPageChange, SpecSnapshot } from '../../../shared/entities.js';
import type { IncludeFilter, MCPEntityDelta, MCPPageDelta } from './types.js';

// ── Fixture: a release snapshot with N entities and M pages (all op:create) ──
function snapshot(entityCount: number, pageCount: number): SpecSnapshot {
  return {
    release: {
      id: 7,
      name: 'v1.2.3',
      description: 'test release',
      createdBy: 'agent',
      createdAt: '2026-06-19T00:00:00.000Z',
    },
    serializer_versions: {},
    entities: Array.from({ length: entityCount }, (_, i) => ({
      type: i % 2 === 0 ? 'endpoint' : 'dto',
      slug: `e${i}`,
      op: 'create' as const,
      data: { name: `Entity ${i}` },
    })),
    pages: Array.from({ length: pageCount }, (_, i) => ({
      path: `pages/p${i}.md`,
      op: 'create' as const,
      data: {},
    })),
  };
}

const ALL_INCLUDE = { include: ['pages', 'entities'] as const };

describe('projectSpecSnapshot — pagination (0.1.70)', () => {
  it('defaults to a 5-item window and reports the full count in total', () => {
    const out = projectSpecSnapshot(snapshot(8, 6), { include: ['pages', 'entities'] });
    expect(out.entities).toHaveLength(DEFAULT_PAGE_LIMIT);
    expect(out.pages).toHaveLength(DEFAULT_PAGE_LIMIT);
    expect(out.total).toEqual({ entities: 8, pages: 6 });
    // newest-first ordering preserved: window starts at the first item
    expect(out.entities?.[0]?.slug).toBe('e0');
  });

  it('offset windows into each list independently', () => {
    const out = projectSpecSnapshot(snapshot(8, 6), { include: ['pages', 'entities'] }, { limit: 3, offset: 3 });
    expect(out.entities?.map((e) => e.slug)).toEqual(['e3', 'e4', 'e5']);
    expect(out.pages?.map((p) => p.path)).toEqual(['pages/p3.md', 'pages/p4.md', 'pages/p5.md']);
    expect(out.total).toEqual({ entities: 8, pages: 6 });
  });

  it('limit larger than the list returns everything (no upper bound)', () => {
    const out = projectSpecSnapshot(snapshot(3, 2), { include: ['pages', 'entities'] }, { limit: 1000, offset: 0 });
    expect(out.entities).toHaveLength(3);
    expect(out.pages).toHaveLength(2);
  });

  it("include: ['entities'] omits the pages key and total.pages", () => {
    const out = projectSpecSnapshot(snapshot(8, 6), { include: ['entities'] });
    expect(out.entities).toBeDefined();
    expect(out.pages).toBeUndefined();
    expect(out.total).toEqual({ entities: 8 });
    expect(out.total.pages).toBeUndefined();
  });

  it("include: ['pages'] omits the entities key and total.entities", () => {
    const out = projectSpecSnapshot(snapshot(8, 6), { include: ['pages'] });
    expect(out.pages).toBeDefined();
    expect(out.entities).toBeUndefined();
    expect(out.total).toEqual({ pages: 6 });
  });

  it('total.entities counts AFTER the entityTypes filter, BEFORE limit/offset', () => {
    // 8 entities alternate endpoint/dto → 4 endpoints
    const out = projectSpecSnapshot(snapshot(8, 0), {
      ...ALL_INCLUDE,
      include: ['entities'],
      entityTypes: ['endpoint'],
    });
    expect(out.total.entities).toBe(4);
    expect(out.entities?.every((e) => e.type === 'endpoint')).toBe(true);
  });
});

// ── Fixture: a release_diff with 4 entities (create/update/delete/create) and ──
// ── 2 pages (create/delete). from/to snapshots carry the before/after data.   ──
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

function diffFixture(): { raw: RawDelta; from: SpecSnapshot; to: SpecSnapshot } {
  const release = (id: number, name: string): SpecSnapshot['release'] => ({
    id,
    name,
    description: '',
    createdBy: 'agent',
    createdAt: '2026-06-19T00:00:00.000Z',
  });
  const raw: RawDelta = {
    from: { id: 1, name: 'v1' },
    to: { id: 2, name: 'v2' },
    entities: [
      { type: 'endpoint', slug: 'ep-a', op: 'created' },
      { type: 'endpoint', slug: 'ep-b', op: 'modified' },
      { type: 'dto', slug: 'dto-c', op: 'deleted' },
      { type: 'dto', slug: 'dto-d', op: 'created' },
    ],
    pages: [emptyPage('pages/new.md', 'created'), emptyPage('pages/gone.md', 'deleted')],
  };
  const to: SpecSnapshot = {
    release: release(2, 'v2'),
    serializer_versions: {},
    entities: [
      { type: 'endpoint', slug: 'ep-a', op: 'create', data: { name: 'Endpoint A' } },
      { type: 'endpoint', slug: 'ep-b', op: 'update', data: { name: 'Endpoint B (new)' } },
      { type: 'dto', slug: 'dto-d', op: 'create', data: { name: 'Dto D' } },
    ],
    pages: [{ path: 'pages/new.md', op: 'create', data: { content: '' } }],
  };
  const from: SpecSnapshot = {
    release: release(1, 'v1'),
    serializer_versions: {},
    entities: [
      { type: 'endpoint', slug: 'ep-b', op: 'update', data: { name: 'Endpoint B (old)' } },
      { type: 'dto', slug: 'dto-c', op: 'delete', data: { name: 'Dto C' } },
    ],
    pages: [{ path: 'pages/gone.md', op: 'delete', data: { content: '' } }],
  };
  return { raw, from, to };
}

const DIFF_INCLUDE: { include: IncludeFilter[] } = { include: ['pages', 'entities'] };

describe('projectReleaseDiff — summaryOnly + pagination (0.1.71)', () => {
  it('summaryOnly:true returns a light delta-map: identifiers + op, no before/after/content', () => {
    const { raw, from, to } = diffFixture();
    const out = projectReleaseDiff(raw, from, to, DIFF_INCLUDE, { summaryOnly: true });

    // full lists, window ignored even with a tiny limit
    expect(out.total).toEqual({ entities: 4, pages: 2 });
    const entities = out.entities as unknown as Array<Record<string, unknown>>;
    expect(entities).toHaveLength(4);
    expect(entities.map((e) => e.op)).toEqual(['create', 'update', 'delete', 'create']);
    // op:'delete' present (entity lives only in `from`)
    expect(entities.find((e) => e.slug === 'dto-c')).toMatchObject({ op: 'delete', name: 'Dto C' });
    // light = identifiers only, no heavy payload
    for (const e of entities) {
      expect(e).not.toHaveProperty('before');
      expect(e).not.toHaveProperty('after');
      expect(Object.keys(e).sort()).toEqual(['name', 'op', 'slug', 'type']);
    }
    const pages = out.pages as unknown as Array<Record<string, unknown>>;
    expect(pages).toEqual([
      { path: 'pages/new.md', op: 'create' },
      { path: 'pages/gone.md', op: 'delete' },
    ]);
  });

  it('summaryOnly:true ignores limit/offset (the probe-map stays complete)', () => {
    const { raw, from, to } = diffFixture();
    const out = projectReleaseDiff(raw, from, to, DIFF_INCLUDE, {
      summaryOnly: true,
      limit: 1,
      offset: 2,
    });
    expect(out.entities).toHaveLength(4);
    expect(out.pages).toHaveLength(2);
  });

  it('heavy mode windows entities[]/pages[] independently; total is the pre-window count', () => {
    const { raw, from, to } = diffFixture();
    const out = projectReleaseDiff(raw, from, to, DIFF_INCLUDE, { limit: 2, offset: 1 });
    expect(out.total).toEqual({ entities: 4, pages: 2 });

    const entities = out.entities as MCPEntityDelta[];
    expect(entities.map((e) => e.slug)).toEqual(['ep-b', 'dto-c']); // slice(1, 3)
    // heavy payload present: update carries before+after, delete carries before only
    const upd = entities.find((e) => e.slug === 'ep-b')!;
    expect(upd.before).toEqual({ name: 'Endpoint B (old)' });
    expect(upd.after).toEqual({ name: 'Endpoint B (new)' });
    const del = entities.find((e) => e.slug === 'dto-c')!;
    expect(del.before).toEqual({ name: 'Dto C' });
    expect(del.after).toBeUndefined();

    const pages = out.pages as MCPPageDelta[];
    expect(pages.map((p) => p.path)).toEqual(['pages/gone.md']); // slice(1, 3) of 2 pages
  });

  it('offset beyond total → empty list + total still present', () => {
    const { raw, from, to } = diffFixture();
    const out = projectReleaseDiff(raw, from, to, DIFF_INCLUDE, { offset: 10 });
    expect(out.entities).toEqual([]);
    expect(out.pages).toEqual([]);
    expect(out.total).toEqual({ entities: 4, pages: 2 });
  });

  it('total keys stay lock-step with include', () => {
    const { raw, from, to } = diffFixture();
    const out = projectReleaseDiff(
      raw,
      from,
      to,
      { include: ['entities'] as IncludeFilter[] },
      { summaryOnly: true },
    );
    expect(out.pages).toBeUndefined();
    expect(out.total).toEqual({ entities: 4 });
    expect(out.total?.pages).toBeUndefined();
  });

  it('empty diff (from === to) → total zeros + empty lists', () => {
    const { from, to } = diffFixture();
    const emptyRaw: RawDelta = { from: { id: 2, name: 'v2' }, to: { id: 2, name: 'v2' }, entities: [], pages: [] };
    const out = projectReleaseDiff(emptyRaw, from, to, DIFF_INCLUDE, { summaryOnly: true });
    expect(out.total).toEqual({ entities: 0, pages: 0 });
    expect(out.entities).toEqual([]);
    expect(out.pages).toEqual([]);
  });
});

describe('resolvePagination — validation (0.1.70)', () => {
  it('applies defaults of limit 5 / offset 0', () => {
    expect(resolvePagination(undefined, undefined)).toEqual({ limit: DEFAULT_PAGE_LIMIT, offset: 0 });
  });

  it('passes through provided values', () => {
    expect(resolvePagination(10, 2)).toEqual({ limit: 10, offset: 2 });
  });

  it('throws INVALID_PAGINATION on negative limit', () => {
    expect(() => resolvePagination(-1, 0)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGINATION' }) as unknown as Error,
    );
  });

  it('throws INVALID_PAGINATION on negative offset', () => {
    let caught: unknown;
    try {
      resolvePagination(5, -3);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe('INVALID_PAGINATION');
  });
});

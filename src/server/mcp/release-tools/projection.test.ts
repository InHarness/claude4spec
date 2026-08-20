import { describe, it, expect } from 'vitest';
import { DEFAULT_PAGE_LIMIT, projectReleaseDiff, projectSpecSnapshot } from './projection.js';
import { resolvePagination } from './index.js';
import { DomainError } from '../../services/tags.js';
import type { RawDelta, RawDeltaPageChange, SpecSnapshot } from '../../../shared/entities.js';
import type { IncludeFilter, MCPEntityDelta, MCPPageDelta } from './types.js';
import { DEFAULT_BUDGET_CHARS } from '../../discovery/budget.js';

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
      { type: 'endpoint', slug: 'ep-a', op: 'created', changes: [] },
      // 0.2.31 — the entity vocabulary spells this `updated`; L3 still projects
      // it to `update`, which is the point of the two vocabularies being separate.
      { type: 'endpoint', slug: 'ep-b', op: 'updated', changes: [] },
      { type: 'dto', slug: 'dto-c', op: 'deleted', changes: [] },
      { type: 'dto', slug: 'dto-d', op: 'created', changes: [] },
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

  it('summaryOnly:true ignores limit (the probe-map stays complete)', () => {
    const { raw, from, to } = diffFixture();
    const out = projectReleaseDiff(raw, from, to, DIFF_INCLUDE, { summaryOnly: true, limit: 1 });
    expect(out.entities).toHaveLength(4);
    expect(out.pages).toHaveLength(2);
    // Nothing degraded, so the envelope stays quiet.
    expect(out.truncationHint).toBeUndefined();
  });

  /**
   * 0.2.40 — `offset` is the ONE window control light mode honours, because it
   * is the cursor `truncationHint` points at when the identity map itself does
   * not fit. A hint telling the caller to resume from an offset the operation
   * ignored would be unfollowable.
   */
  it('summaryOnly:true honours offset as the resume cursor', () => {
    const { raw, from, to } = diffFixture();
    const out = projectReleaseDiff(raw, from, to, DIFF_INCLUDE, {
      summaryOnly: true,
      limit: 1,
      offset: 2,
    });
    expect(out.total).toEqual({ entities: 4, pages: 2 });
    expect(out.entities).toHaveLength(2); // 4 total, resumed at 2
    expect(out.pages).toHaveLength(0); // 2 total, resumed past the end
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


/**
 * 0.2.40 — the response budget on `release_diff` / `release_show`.
 *
 * The hole these close: an over-budget delta used to be handed over oversized,
 * and the consumer had no way to tell a payload that fell out from a thing that
 * never changed. Every assertion below is about that distinction being
 * observable.
 */
describe('release budget — explicit degradation (0.2.40)', () => {
  /** A snapshot whose entity payloads are deliberately far past the budget. */
  function fatSnapshot(entityCount: number, chars: number): SpecSnapshot {
    return {
      release: {
        id: 9,
        name: 'v9',
        description: 'fat',
        createdBy: 'agent',
        createdAt: '2026-08-20T00:00:00.000Z',
      },
      serializer_versions: {},
      entities: Array.from({ length: entityCount }, (_, i) => ({
        type: 'endpoint',
        slug: `fat${i}`,
        op: 'create' as const,
        data: { name: `Fat ${i}`, blob: 'z'.repeat(chars) },
      })),
      pages: [],
    };
  }

  function fatRaw(entityCount: number): RawDelta {
    return {
      from: { id: 8, name: 'v8' },
      to: { id: 9, name: 'v9' },
      entities: Array.from({ length: entityCount }, (_, i) => ({
        type: 'endpoint',
        slug: `fat${i}`,
        op: 'created' as const,
      })),
      pages: [],
    } as unknown as RawDelta;
  }

  const ENTITIES_ONLY = { include: ['entities'] as IncludeFilter[] };

  it('[ac:ac-release-diff-ponad-budzet-element-z-t] every over-budget item is returned marked, never omitted, and the envelope says how to retry', () => {
    const count = 6;
    // Each payload is a third of the budget, so the window cannot hold all six.
    const to = fatSnapshot(count, Math.floor(DEFAULT_BUDGET_CHARS / 3));
    const out = projectReleaseDiff(fatRaw(count), null, to, ENTITIES_ONLY, { limit: count });

    const entities = out.entities as MCPEntityDelta[];
    // NOTHING is dropped: the window asked for six and six came back.
    expect(entities).toHaveLength(count);
    expect(entities.map((e) => e.slug)).toEqual(['fat0', 'fat1', 'fat2', 'fat3', 'fat4', 'fat5']);
    // The ones past the cut kept their identity and lost their payload.
    const degraded = entities.filter((e) => e.truncated === true);
    expect(degraded.length).toBeGreaterThan(0);
    for (const e of degraded) {
      expect(e.after).toBeUndefined();
      expect(e.before).toBeUndefined();
      expect(e.slug).toBeTruthy();
      expect(e.op).toBe('create');
    }
    // The retry instruction lives on the envelope, and ONLY there.
    expect(out.truncationHint).toContain('summaryOnly');
    expect(out.truncationHint).toMatch(/entityTypes|limit|offset/);
    for (const e of entities) expect(e).not.toHaveProperty('truncationHint');
  });

  it('[ac:ac-gwarancja-pierwszej-pozycji-w-release] the first item keeps its payload even when it alone busts the budget', () => {
    // One entity, three times the whole budget: a single-item call is already
    // the smallest possible retry, so degrading it would be a dead end.
    const to = fatSnapshot(2, DEFAULT_BUDGET_CHARS * 3);
    const out = projectReleaseDiff(fatRaw(2), null, to, ENTITIES_ONLY, { limit: 2 });

    const entities = out.entities as MCPEntityDelta[];
    expect(entities[0]!.truncated).toBeUndefined();
    expect(entities[0]!.after).toBeDefined();
    // ...and the second one, which had no room left at all, still came back.
    expect(entities[1]!.truncated).toBe(true);
    expect(entities).toHaveLength(2);
  });

  it('[ac:ac-gwarancja-pierwszej-pozycji-w-release] release_show never returns an empty window because one row was large', () => {
    const out = projectSpecSnapshot(snapshot(8, 6), { include: ['entities'] }, { limit: 8 });
    expect((out.entities ?? []).length).toBeGreaterThan(0);
    expect(out.total).toEqual({ entities: 8 });
  });

  it('[ac:ac-summaryonly-jest-gwarantowanym-dnem-d] summaryOnly fits any delta: it pages the identity map instead of losing rows', () => {
    // 4000 identity rows — the map itself is what busts the budget here.
    const count = 4000;
    const to = fatSnapshot(count, 0);
    const out = projectReleaseDiff(fatRaw(count), null, to, ENTITIES_ONLY, { summaryOnly: true });

    expect(out.total).toEqual({ entities: count });
    const shown = (out.entities ?? []).length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(count);
    // The response actually fits.
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(DEFAULT_BUDGET_CHARS * 1.1);
    // And the hint names the cursor to resume from — which light mode honours.
    expect(out.truncationHint).toContain(`offset: ${shown}`);

    const next = projectReleaseDiff(fatRaw(count), null, to, ENTITIES_ONLY, {
      summaryOnly: true,
      offset: shown,
    });
    // Resuming continues where the first call stopped: no row is lost, only postponed.
    expect((next.entities as Array<{ slug: string }>)[0]!.slug).toBe(`fat${shown}`);
  });

  it('[ac:ac-asymetria-ciecia-snapshot-encji-wypad] the cut follows the payload: an entity snapshot drops whole, a section body is cut as text', () => {
    const big = 'x'.repeat(DEFAULT_BUDGET_CHARS);
    const rawPages = [
      { path: 'pages/a.md', op: 'created', added_sections: [{ anchor: 'aaaaaa11', heading: 'A', content: big }], removed_sections: [], modified_sections: [], moved_sections: [], frontmatter_diff: null, xml_refs_diff: null },
      { path: 'pages/b.md', op: 'created', added_sections: [{ anchor: 'bbbbbb22', heading: 'B', content: big }], removed_sections: [], modified_sections: [], moved_sections: [], frontmatter_diff: null, xml_refs_diff: null },
    ];
    const raw = {
      from: { id: 8, name: 'v8' },
      to: { id: 9, name: 'v9' },
      entities: [
        { type: 'endpoint', slug: 'fat0', op: 'created' as const },
        { type: 'endpoint', slug: 'fat1', op: 'created' as const },
      ],
      pages: rawPages,
    } as unknown as RawDelta;
    const to = {
      ...fatSnapshot(2, DEFAULT_BUDGET_CHARS),
      pages: rawPages.map((p) => ({ path: p.path, op: 'create' as const, data: {} })),
    };

    const out = projectReleaseDiff(raw, null, to, { include: ['entities', 'pages'] }, { limit: 2 });

    // Entity side: the snapshot is GONE, not shortened — half a serialized
    // record is malformed data, not a smaller record.
    const degradedEntity = (out.entities as MCPEntityDelta[]).find((e) => e.truncated === true)!;
    expect(degradedEntity.after).toBeUndefined();
    expect(degradedEntity.before).toBeUndefined();

    // Section side: `content` is STILL THERE, just shorter — and marked.
    const degradedSection = (out.pages as MCPPageDelta[])
      .flatMap((p) => p.sections)
      .find((s) => s.truncated === true)!;
    expect(degradedSection).toBeDefined();
    expect(typeof degradedSection.content).toBe('string');
    expect(degradedSection.content!.length).toBeGreaterThan(0);
    expect(degradedSection.content!.length).toBeLessThan(big.length);
    expect(degradedSection.anchor).toBeTruthy();
  });

  it('a delta that fits carries no marker at all — absence of `truncated` is a guarantee', () => {
    const out = projectReleaseDiff(fatRaw(2), null, fatSnapshot(2, 10), ENTITIES_ONLY, { limit: 2 });
    expect(out.truncationHint).toBeUndefined();
    for (const e of out.entities as MCPEntityDelta[]) expect(e.truncated).toBeUndefined();
  });
});

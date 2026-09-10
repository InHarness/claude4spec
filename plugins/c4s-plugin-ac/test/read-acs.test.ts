/**
 * The envelope's reader, over the M39 plugin surface.
 *
 * The LAYOUT question — is `verifies` embedded JSON or a projected table — is
 * not asked here. It is answered against a real projection in
 * `src/server/discovery/ops/ac-rules.test.ts`, because a fake can only ever
 * confirm the caller's own belief about storage, which is exactly how the
 * embedded-vs-projected mix-up survived for two releases.
 *
 * What IS asked here is the shape of the CALLS, which is the thing extraction
 * changed: the surface hands back `EntityRow {slug, title}` from `listEntities`
 * and takes no `select` there, so reading the active ACs whole is two
 * operations and a page loop rather than one reader query. These cases pin that
 * loop — the paging, the batching, the opt-in default predicate — because
 * getting it wrong reads as "the audit found fewer criteria than there are",
 * which nothing else would report.
 */

import { describe, expect, it, vi } from 'vitest';
import { readActiveAcs } from '../src/entity/ac/backend/read-acs.js';
import type { ReadOps } from '../src/host-kit/host-types.js';

type Row = { slug: string; title: string };

/**
 * The host's own cap, restated. `get_entities` THROWS on the 51st slug rather
 * than truncating, and a fake without this is how a batch size of 100 passed
 * every case here while failing on any real project with 51 criteria.
 */
const HOST_MAX_SLUGS = 50;

/**
 * A surface that pages. `pageSize` is deliberately tiny so the loop runs several
 * times over a handful of rows — the real page is 200, and a test that never
 * crossed a boundary would pass with the loop deleted.
 */
function opsOver(
  acs: Array<{ slug: string; title: string; kind?: string; tags?: string[]; verifies?: unknown }>,
  pageSize = 2,
): ReadOps & { calls: { list: unknown[]; get: unknown[] } } {
  const calls = { list: [] as unknown[], get: [] as unknown[] };
  const rows: Row[] = acs.map((a) => ({ slug: a.slug, title: a.title }));
  const bySlug = new Map(acs.map((a) => [a.slug, a]));

  return {
    calls,
    listEntities: ((input: Record<string, unknown>) => {
      calls.list.push(input);
      const offset = (input.offset as number) ?? 0;
      const limit = Math.min((input.limit as number) ?? pageSize, pageSize);
      const items = rows.slice(offset, offset + limit);
      return {
        mode: 'items',
        type: 'ac',
        items,
        total: rows.length,
        hasMore: offset + items.length < rows.length,
      };
    }) as ReadOps['listEntities'],
    getEntities: ((input: { type: string; slugs: string[]; select?: string[] }) => {
      calls.get.push(input);
      if (input.slugs.length > HOST_MAX_SLUGS) {
        throw new Error(`get_entities accepts at most ${HOST_MAX_SLUGS} slugs (got ${input.slugs.length})`);
      }
      return {
        type: input.type,
        selectedFields: input.select ?? [],
        results: input.slugs.map((slug) => {
          const a = bySlug.get(slug);
          return {
            slug,
            entity: a
              ? {
                  slug,
                  title: a.title,
                  kind: a.kind ?? 'requirement',
                  tags: a.tags ?? [],
                  verifies: a.verifies ?? [],
                }
              : null,
          };
        }),
      };
    }) as ReadOps['getEntities'],
    describeTypes: (() => ({ types: [] })) as ReadOps['describeTypes'],
    getFieldContent: (() => ({
      type: '',
      slug: '',
      field: '',
      content: '',
      bytes: 0,
    })) as ReadOps['getFieldContent'],
  };
}

describe('readActiveAcs — over the bound read operations', () => {
  it('pages the list until the surface says there is no more', () => {
    const ops = opsOver(
      Array.from({ length: 5 }, (_, i) => ({ slug: `ac-${i}`, title: `criterion ${i}` })),
    );

    expect(readActiveAcs(ops).map((a) => a.slug)).toEqual([
      'ac-0',
      'ac-1',
      'ac-2',
      'ac-3',
      'ac-4',
    ]);
    // 5 rows at 2 per page: three calls, the last one short.
    expect(ops.calls.list).toHaveLength(3);
  });

  it('asks for the active set explicitly, and for an offset-stable order', () => {
    const ops = opsOver([{ slug: 'ac-1', title: 'x' }]);
    readActiveAcs(ops);

    const first = ops.calls.list[0] as Record<string, unknown>;
    // `applyDefaultPredicate` is OPT-IN. A transport read of "the active ACs" is
    // exactly the caller that opts in — and the predicate itself lives in this
    // type's `systemPrompt`, so nothing here restates `status = 'active'`.
    expect(first.applyDefaultPredicate).toBe(true);
    // `createdAt` is the only sort whose offset window is stable under
    // concurrent writes. Paging on `title` could show a row twice or not at all.
    expect(first.sort).toBe('createdAt');
  });

  it('reads the width through getEntities, naming the fields it needs', () => {
    const ops = opsOver([
      { slug: 'ac-1', title: 'the endpoint answers', kind: 'edge-case', tags: ['m19'], verifies: [
        { type: 'endpoint', slug: 'get-users' },
      ] },
    ]);

    expect(readActiveAcs(ops)).toEqual([
      {
        slug: 'ac-1',
        title: 'the endpoint answers',
        kind: 'edge-case',
        tags: ['m19'],
        verifies: [{ type: 'endpoint', slug: 'get-users' }],
      },
    ]);
    const get = ops.calls.get[0] as { select: string[] };
    // `verifies` whole: it is a top-level value collection, so it is selectable
    // as a field and `verifies.slug` would be rejected. The pair IS the unit.
    expect(get.select).toContain('verifies');
    expect(get.select).toContain('kind');
  });

  it('skips a corrupt verify entry rather than surfacing a half-formed reference', () => {
    const ops = opsOver([
      {
        slug: 'ac-1',
        title: 'mixed',
        verifies: [
          { type: 'endpoint', slug: 'get-users' },
          { type: 'endpoint' },
          { slug: 'orphan' },
          'not an object',
        ],
      },
    ]);

    // A ref with no slug would be reported as broken by `classifyVerifies`,
    // which is worse than not reporting it: the entity it names is unknowable.
    expect(readActiveAcs(ops)[0]?.verifies).toEqual([{ type: 'endpoint', slug: 'get-users' }]);
  });

  it('drops a slug that vanished between the two calls', () => {
    const ops = opsOver([{ slug: 'ac-1', title: 'still here' }]);
    const original = ops.getEntities;
    // A delete racing the audit: the list named it, the fetch cannot find it.
    ops.getEntities = ((input: Parameters<ReadOps['getEntities']>[0]) => {
      const res = original(input) as { results: Array<{ slug: string; entity: unknown }> };
      return { ...res, results: res.results.map((r) => ({ ...r, entity: null })) };
    }) as ReadOps['getEntities'];

    expect(readActiveAcs(ops)).toEqual([]);
  });

  it('never asks for more slugs in one call than the host accepts', () => {
    // 120 criteria is an ordinary project — this repo's own spec has 253. The
    // fake throws exactly where the host does, so a batch size above the cap
    // fails here instead of failing the whole audit in production.
    const ops = opsOver(
      Array.from({ length: 120 }, (_, i) => ({ slug: `ac-${i}`, title: `criterion ${i}` })),
      500,
    );

    expect(readActiveAcs(ops)).toHaveLength(120);
    for (const call of ops.calls.get as Array<{ slugs: string[] }>) {
      expect(call.slugs.length).toBeLessThanOrEqual(HOST_MAX_SLUGS);
    }
  });

  it('re-asks for entities the response budget degraded, instead of reading them as deletes', () => {
    const ops = opsOver(
      Array.from({ length: 4 }, (_, i) => ({ slug: `ac-${i}`, title: `criterion ${i}` })),
      10,
    );
    const original = ops.getEntities;
    // The host answers every slug it was named, but everything past the budget
    // line comes back meta-only with `truncated` on the envelope. Only the
    // first item is guaranteed whole, so shrinking the ask is the retry.
    ops.getEntities = ((input: Parameters<ReadOps['getEntities']>[0]) => {
      const res = original(input) as {
        results: Array<{ slug: string; entity: unknown }>;
        truncated?: boolean;
        message?: string;
      };
      if (res.results.length < 2) return res;
      return {
        ...res,
        truncated: true,
        message: 'response budget reached',
        results: res.results.map((r, i) => (i === 0 ? r : { ...r, entity: null })),
      };
    }) as ReadOps['getEntities'];

    // Read as deletes, this returns one AC and reports nothing wrong — the
    // silent-undercount failure the whole file is guarding.
    expect(readActiveAcs(ops).map((a) => a.slug).sort()).toEqual(['ac-0', 'ac-1', 'ac-2', 'ac-3']);
  });

  it('stops on an empty page rather than looping forever', () => {
    const ops = opsOver([]);
    // `hasMore` is false here, but the belt-and-braces guard is the empty-items
    // check: a host that answered `hasMore: true` on an empty page would
    // otherwise spin.
    const spy = vi.spyOn(ops, 'listEntities');
    expect(readActiveAcs(ops)).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

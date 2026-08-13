/**
 * The `detail` computed view's two edge rules, which had no test.
 *
 * `detail` is the only view in this package that resolves a reference, so it is
 * the only one that can recurse forever or trip over a target that is gone. Both
 * outcomes are specified as non-events: resolve exactly one level and stop, and
 * report a missing target as data rather than as an exception.
 *
 * The depth limit used to be spelled `ctx.depth >= ctx.maxDepth`, against a
 * `depth` no caller ever set — unreachable code pretending to be a guard. It was
 * deleted, so the rule is now a SHAPE rather than a parameter: the nested DTO
 * carries its own fields and nothing that would resolve further. That shape is
 * what these tests pin, because nothing else does.
 */

import { describe, expect, it } from 'vitest';
import { endpointSerializer } from '../../src/entity/endpoint/views.js';
import type { RawEntity } from '../../src/types.js';

const ENDPOINT: RawEntity = {
  type: 'endpoint',
  slug: 'get-users',
  data: {
    method: 'GET',
    path: '/users',
    summary: 'List users',
    description: 'Returns every user.',
  },
  tags: ['public'],
} as RawEntity;

/**
 * A hand-built L9 reader. `linkedDtos` is answered from `readCollection` (the
 * host door the junction goes through) and each DTO from `getEntity`; `dtos`
 * lists the DTO slugs that still EXIST, so dropping one simulates a delete
 * without touching the link.
 */
function readerWith(dtos: Record<string, unknown>) {
  return {
    readCollection: () => [
      { dto: 'user-dto', relation: 'response', statusCode: 200 },
      { dto: 'error-dto', relation: 'error', statusCode: 500 },
    ],
    getEntity: (type: string, slug: string) =>
      type === 'dto' ? (dtos[slug] ?? null) : null,
    findSectionReferences: () => [],
  } as never;
}

function dto(slug: string, title: string, fields: unknown) {
  return { type: 'dto', slug, data: { title, description: null, fields }, tags: [] };
}

const detail = endpointSerializer.views!.detail!;

describe('endpoint.detail — reference resolution depth', () => {
  it('[ac:ac-widok-obliczeniowy-detail-ma-depth-li] resolves each linked DTO one level deep and carries no second hop', () => {
    const out = detail(
      ENDPOINT,
      readerWith({
        // The nested DTO names ANOTHER dto in a field type. One level means that
        // stays a slug: it is not looked up, and no `dtos`/`_references` of its
        // own appear on it.
        'user-dto': dto('user-dto', 'User', [{ name: 'address', type: 'address-dto' }]),
        'error-dto': dto('error-dto', 'Error', [{ name: 'message', type: 'string' }]),
      }),
    ) as { dtos: Array<{ dtoSlug: string; dto: Record<string, unknown> | null }> };

    // By slug, not by index: the junction re-sorts links by relation, so
    // `error` precedes `response` regardless of declaration order.
    const nested = out.dtos.find((d) => d.dtoSlug === 'user-dto')!.dto!;
    expect(nested).toMatchObject({ slug: 'user-dto', title: 'User' });
    // Its own fields travel, its own edges do not.
    expect(nested.fields).toEqual([{ name: 'address', type: 'address-dto' }]);
    expect(nested).not.toHaveProperty('dtos');
    expect(nested).not.toHaveProperty('_references');
    expect(nested).not.toHaveProperty('_brokenRefs');
  });
});

describe('endpoint.detail — a link whose DTO is gone', () => {
  it('[ac:ac-widok-obliczeniowy-detail-ma-depth-li] comes back as null plus _brokenRefs instead of throwing', () => {
    const out = detail(
      ENDPOINT,
      readerWith({ 'user-dto': dto('user-dto', 'User', []) }), // `error-dto` deleted
    ) as {
      dtos: Array<{ dtoSlug: string; dto: unknown }>;
      _brokenRefs?: string[];
    };

    expect(out._brokenRefs).toEqual(['dto:error-dto']);

    const broken = out.dtos.find((d) => d.dtoSlug === 'error-dto')!;
    expect(broken.dto).toBeNull();
    // The link itself survives — the edge is still declared, only its target is
    // missing, and the caller needs to see which one to be able to repair it.
    expect(broken).toMatchObject({ dtoSlug: 'error-dto', relation: 'error' });

    // The surviving link is unaffected: one broken ref does not void the view.
    expect(out.dtos.find((d) => d.dtoSlug === 'user-dto')!.dto).toMatchObject({ slug: 'user-dto' });
  });

  it('[ac:ac-widok-obliczeniowy-detail-ma-depth-li] omits _brokenRefs entirely when every link resolved', () => {
    const out = detail(
      ENDPOINT,
      readerWith({
        'user-dto': dto('user-dto', 'User', []),
        'error-dto': dto('error-dto', 'Error', []),
      }),
    ) as Record<string, unknown>;

    expect(out).not.toHaveProperty('_brokenRefs');
  });
});

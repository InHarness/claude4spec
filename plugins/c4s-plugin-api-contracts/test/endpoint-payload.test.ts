/**
 * The endpoint payload across its three vintages.
 *
 * `endpoint` is the one type whose payload shape actually moved in 0.2.9
 * (`payloadVersion` 1 → 2), so it is the one type where "which spelling is this
 * payload written in?" is a live question at every boundary: the upgrade chain
 * on the way in, and `diff` when comparing two captures that may sit on opposite
 * sides of the bump.
 *
 * The diff half of this file exists because a real bug got past the whole unit
 * suite: `coerceEndpoint` was left reading only the OLDER spellings, so a v2
 * payload coerced its junction to `[]` on both sides and every endpoint diff
 * reported no DTO changes at all. Nothing failed, because nothing had ever
 * handed `coerceEndpoint` a current-shape payload.
 */

import { describe, expect, it } from 'vitest';
import { endpointSerialization } from '../src/entity/endpoint/serializer.js';
import { diffFromSchema } from '../../../src/server/serialization/schema-diff.js';
import { endpointPayloadV1ToV2 } from '../src/entity/endpoint/upgrades.js';
import { endpointEntity } from '../src/entity/endpoint/index.js';

const V2 = {
  slug: 'get-users',
  method: 'GET',
  path: '/users',
  summary: '',
  description: null,
  linkedDtos: [{ dto: 'user-dto', relation: 'response', statusCode: 200 }],
  tags: [],
};

describe('endpoint payload v1 → v2', () => {
  it('declares exactly one upgrade step per version it has crossed', () => {
    // Registration enforces this too; asserting it here is what makes a future
    // bump-without-a-step fail in the package that owns both.
    expect(endpointEntity.payloadVersion).toBe(3);
    // Two since 0.2.22: the junction reshape, then the reserved `title`.
    expect(endpointSerialization.payloadUpgrades).toHaveLength(2);
  });

  it('renames the junction from column names to declared field names', () => {
    const v1 = {
      slug: 'get-users',
      method: 'GET',
      path: '/users',
      summary: 'List',
      linked_dtos: [
        { dto_slug: 'user-dto', relation: 'response', status_code: 200 },
        // A NULL status_code survives as null rather than becoming 0 — it is
        // part of the junction's UNIQUE key.
        { dto_slug: 'order-dto', relation: 'request', status_code: null },
      ],
    };
    const out = endpointPayloadV1ToV2(v1) as Record<string, unknown>;
    expect(out.linkedDtos).toEqual([
      { dto: 'user-dto', relation: 'response', statusCode: 200 },
      { dto: 'order-dto', relation: 'request', statusCode: null },
    ]);
    expect(out.linked_dtos).toBeUndefined();
  });

  it("applies the declaration's own answer to the summary it contradicted", () => {
    // v1 wrote `null` for an empty summary against `required, default: ''`.
    expect((endpointPayloadV1ToV2({ ...V2, summary: null }) as { summary: string }).summary).toBe('');
    // A real summary is content and survives untouched.
    expect((endpointPayloadV1ToV2({ ...V2, summary: 'List' }) as { summary: string }).summary).toBe('List');
  });

  it('handles the pre-M17 `dtos[]` shape, relocated out of coerceEndpoint', () => {
    const preM17 = { slug: 'get-users', dtos: [{ dtoSlug: 'user-dto', relation: 'response', statusCode: 200 }] };
    const out = endpointPayloadV1ToV2(preM17) as Record<string, unknown>;
    expect(out.linkedDtos).toEqual([{ dto: 'user-dto', relation: 'response', statusCode: 200 }]);
    expect(out.dtos).toBeUndefined();
  });

  it('gives an endpoint with no links an empty collection, not an absent one', () => {
    const out = endpointPayloadV1ToV2({ slug: 'post-ping', method: 'POST', path: '/ping' }) as Record<string, unknown>;
    expect(out.linkedDtos).toEqual([]);
  });

  it('is idempotent on a payload already at v2', () => {
    // The chain should never reach a v2 payload, but a step that mangles one is
    // a trap waiting for the next bump to spring it.
    expect(endpointPayloadV1ToV2(V2)).toEqual(V2);
  });
});

/**
 * 0.2.31 — the delta comes from the HOST, walking `endpoint`'s own schema.
 *
 * These cases used to pin `endpointDiff`, a hand-written function that read
 * three payload vintages and emitted `dto_added` / `status_code_changed`. The
 * function is gone; what replaced it is a declaration —
 * `linkedDtos: { kind: 'value', identity: ['dto', 'relation'] }` — and these
 * cases now pin that the declaration produces the same distinctions.
 *
 * The interesting one is the status code: `statusCode` is part of the
 * collection's physical `keyFields` but deliberately NOT of its identity, so
 * changing it is an `item_modified` on the same link rather than a removal and
 * an unrelated arrival.
 */
describe('the host delta reads the CURRENT payload shape', () => {
  const schema = endpointEntity.data!.schema;

  it('reports a DTO link added between two v2 payloads', () => {
    const before = { ...V2, linkedDtos: [] };
    const changes = diffFromSchema(schema, before, V2);
    expect(changes).toEqual([
      {
        op: 'item_added',
        path: 'linkedDtos',
        identity: { dto: 'user-dto', relation: 'response' },
        item: { dto: 'user-dto', relation: 'response', statusCode: 200 },
      },
    ]);
  });

  it('reports a status code change as an EDIT to the same link, not a swap', () => {
    const after = { ...V2, linkedDtos: [{ dto: 'user-dto', relation: 'response', statusCode: 201 }] };
    expect(diffFromSchema(schema, V2, after)).toEqual([
      {
        op: 'item_modified',
        path: 'linkedDtos',
        identity: { dto: 'user-dto', relation: 'response' },
        changes: [
          { op: 'field_changed', path: 'linkedDtos[].statusCode', from: 200, to: 201 },
        ],
      },
    ]);
  });

  it('reports a pure reshuffle of the links as no change at all', () => {
    // What the identity declaration buys: `noop` is structural — no operations
    // were produced — rather than a rule anyone had to write down.
    const two = [
      { dto: 'user-dto', relation: 'response', statusCode: 200 },
      { dto: 'error-dto', relation: 'error', statusCode: 500 },
    ];
    const a = { ...V2, linkedDtos: two };
    const b = { ...V2, linkedDtos: [...two].reverse() };
    expect(diffFromSchema(schema, a, b)).toEqual([]);
  });
});

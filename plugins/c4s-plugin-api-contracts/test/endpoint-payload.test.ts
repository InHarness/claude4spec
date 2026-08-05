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
import { endpointSerializer } from '../src/entity/endpoint/views.js';
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
  it('declares exactly one upgrade step for its declared version', () => {
    // Registration enforces this too; asserting it here is what makes a future
    // bump-without-a-step fail in the package that owns both.
    expect(endpointEntity.payloadVersion).toBe(2);
    expect(endpointSerializer.payloadUpgrades).toHaveLength(1);
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

describe('endpointDiff reads the CURRENT payload shape', () => {
  const diff = endpointSerializer.diff!;

  it('reports a DTO link added between two v2 payloads', () => {
    // The regression: with `coerceEndpoint` reading only v1 spellings, both
    // sides coerced to `[]` and this came back `noop`.
    const before = { ...V2, linkedDtos: [] };
    const result = diff(before, V2, 'get-users');
    expect(result.op).toBe('modified');
    expect((result.changes as { dto_added?: unknown[] }).dto_added).toEqual([
      { dto_slug: 'user-dto', relation: 'response', status_code: 200 },
    ]);
  });

  it('reports a status code change between two v2 payloads', () => {
    const after = { ...V2, linkedDtos: [{ dto: 'user-dto', relation: 'response', statusCode: 201 }] };
    const result = diff(V2, after, 'get-users');
    expect((result.changes as { status_code_changed?: Array<{ from: number; to: number }> }).status_code_changed)
      .toEqual([{ dto_slug: 'user-dto', relation: 'response', from: 200, to: 201 }]);
  });

  it('still compares a v1 capture against a v2 one without inventing changes', () => {
    // Two captures either side of the bump describing the SAME endpoint. The
    // release layer upgrades both before diffing, but `coerceEndpoint` reading
    // every vintage is what keeps a stale caller from reporting a phantom edit.
    const v1 = {
      slug: 'get-users',
      method: 'GET',
      path: '/users',
      summary: null,
      description: null,
      linked_dtos: [{ dto_slug: 'user-dto', relation: 'response', status_code: 200 }],
      tags: [],
    };
    const result = diff(v1, V2, 'get-users');
    // `summary` genuinely differs (null vs ''), so this is not `noop` — but the
    // junction must NOT appear as added or removed.
    const changes = (result.changes ?? {}) as Record<string, unknown>;
    expect(changes.dto_added).toBeUndefined();
    expect(changes.dto_removed).toBeUndefined();
  });
});

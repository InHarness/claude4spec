import type { RawEntity } from '../../host-kit/host-types.js';
import type { SerializationContribution } from '@c4s/plugin-runtime';
import type { EndpointDtoRelation, HttpMethod } from '../../types.js';
import { endpointPayloadV1ToV2, endpointPayloadV2ToV3 } from './upgrades.js';

// ─── M17 Snapshot shape (entities/endpoint.md `ensn0sho`) ───────────────────

export interface EndpointSnapshot {
  slug: string;
  title: string;
  method: HttpMethod;
  path: string;
  summary: string | null;
  description: string | null;
  linked_dtos: Array<{
    dto_slug: string;
    relation: EndpointDtoRelation;
    status_code: number | null;
  }>;
  tags: string[];
}

/**
 * 0.2.23 — `endpoint` computes nothing either.
 *
 * Five views went, and the `detail` one was the last automatic reference
 * resolution in the system: it read each linked DTO and inlined its fields, one
 * level deep, mapping a dangling link to `null` and collecting `_brokenRefs`
 * beside the payload. The rule is now universal and much duller — a field
 * flagged `ref` stays a slug, on every surface and at every projection — so a
 * consumer that wants the DTO asks for it by slug, and a broken link reveals
 * itself as `ENTITY_NOT_FOUND` on that second call rather than as an
 * out-of-band marker on this one.
 *
 * Nothing is lost from the record: `linkedDtos` is a declared value collection
 * (`schema.ts`), so the host emits the links inline from the schema without any
 * of this file's help.
 */
/** 0.2.24 — spread onto the type; the `serializer` wrapper is rejected now. */
export const endpointSerialization = {
  /**
   * v1 files spell the junction in column names and coerce an empty `summary`
   * to null; both are what the generated snapshot stopped doing. The chain's
   * LENGTH is checked against `payloadVersion` at registration, so this array
   * and the number in `index.ts` cannot drift apart. v2 → v3 adds `title`.
   */
  payloadUpgrades: [endpointPayloadV1ToV2, endpointPayloadV2ToV3],
} satisfies Pick<SerializationContribution<RawEntity>, 'payloadUpgrades'>;

import type { RawEntity } from '../../host-kit/host-types.js';
import type {
  EntityDiff,
  RestoreContext,
  RestoreResult,
  SerializationContribution,
} from '@c4s/plugin-runtime';
import type { EndpointDtoRelation, HttpMethod } from '../../types.js';
import { ENDPOINT_TYPE } from '../../identity.js';
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

/** Defensive coercion of pre-M17 legacy rows (Endpoint domain object) to the
 *  EndpointSnapshot shape. Post-M17 rows already match the shape. */
/**
 * Normalise a snapshot of ANY vintage into the shape `endpointDiff` compares.
 *
 * A diff is handed two captures that may have been taken years and several
 * payload versions apart, so this has to read every spelling the type has ever
 * written — and after tier B PR2 that includes the CURRENT one, which is the
 * v2 `linkedDtos: [{dto, relation, statusCode}]` the generated snapshot emits.
 *
 * Reading only the older spellings is not a stale branch, it is a silent bug:
 * `linked_dtos` and `dtos` are both absent from a v2 payload, so the junction
 * coerces to `[]` on both sides and every endpoint diff reports NO dto changes
 * at all — linking or unlinking a DTO would show up nowhere in a release diff.
 *
 * The OUTPUT keeps the `dto_slug` / `status_code` spelling on purpose. It feeds
 * `endpointDiff`'s `dto_added` / `dto_removed` / `status_code_changed` changes,
 * which `client/lib/release-diff/entity-diff-bullets.ts` reads by those names.
 * That is a wire contract with the client, not a payload shape, and it is not
 * what this release renamed.
 */
function coerceEndpoint(raw: unknown): EndpointSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  const source =
    // v2 (current): declared field names.
    (Array.isArray(r.linkedDtos) ? (r.linkedDtos as Array<Record<string, unknown>>) : null) ??
    // v1: junction column names.
    (Array.isArray(r.linked_dtos) ? (r.linked_dtos as Array<Record<string, unknown>>) : null) ??
    // pre-M17: the view's resolved `dtos[]`.
    (Array.isArray(r.dtos) ? (r.dtos as Array<Record<string, unknown>>) : null);
  const linked_dtos = (source ?? []).map((d) => ({
    dto_slug: String(d.dto ?? d.dto_slug ?? d.dtoSlug ?? ''),
    relation: String(d.relation ?? '') as EndpointSnapshot['linked_dtos'][number]['relation'],
    status_code: (d.statusCode ?? d.status_code ?? null) as number | null,
  }));
  return {
    slug: String(r.slug ?? ''),
    title: String(r.title ?? ''),
    method: String(r.method ?? '') as EndpointSnapshot['method'],
    path: String(r.path ?? ''),
    summary: (r.summary as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    linked_dtos,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  };
}

function endpointDiff(a: unknown, b: unknown, slug: string): EntityDiff {
  if (a == null && b == null) return { type: 'endpoint', slug, op: 'noop' };
  if (a == null) return { type: 'endpoint', slug, op: 'created' };
  if (b == null) return { type: 'endpoint', slug, op: 'deleted' };
  const sa = coerceEndpoint(a);
  const sb = coerceEndpoint(b);

  const changes: Record<string, unknown> = {};
  const fieldChanges: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const field of ['title', 'method', 'path', 'summary', 'description'] as const) {
    if (sa[field] !== sb[field]) fieldChanges.push({ field, from: sa[field], to: sb[field] });
  }
  if (fieldChanges.length) changes.field_changes = fieldChanges;

  // Junction diff by (relation, dto_slug)
  const keyOf = (l: EndpointSnapshot['linked_dtos'][number]) => `${l.relation}|${l.dto_slug}`;
  const aMap = new Map(sa.linked_dtos.map((l) => [keyOf(l), l]));
  const bMap = new Map(sb.linked_dtos.map((l) => [keyOf(l), l]));
  const dtoAdded: typeof sa.linked_dtos = [];
  const dtoRemoved: typeof sa.linked_dtos = [];
  const statusChanged: Array<{ dto_slug: string; relation: string; from: number | null; to: number | null }> = [];
  for (const [k, link] of bMap) {
    if (!aMap.has(k)) dtoAdded.push(link);
  }
  for (const [k, link] of aMap) {
    const other = bMap.get(k);
    if (!other) {
      dtoRemoved.push(link);
    } else if (other.status_code !== link.status_code) {
      statusChanged.push({
        dto_slug: link.dto_slug,
        relation: link.relation,
        from: link.status_code,
        to: other.status_code,
      });
    }
  }
  if (dtoAdded.length) changes.dto_added = dtoAdded;
  if (dtoRemoved.length) changes.dto_removed = dtoRemoved;
  if (statusChanged.length) changes.status_code_changed = statusChanged;

  // Tag diff (set semantics)
  const tagAdded = sb.tags.filter((t) => !sa.tags.includes(t));
  const tagRemoved = sa.tags.filter((t) => !sb.tags.includes(t));
  if (tagAdded.length) changes.tag_added = tagAdded;
  if (tagRemoved.length) changes.tag_removed = tagRemoved;

  if (Object.keys(changes).length === 0) return { type: 'endpoint', slug, op: 'noop' };
  return { type: 'endpoint', slug, op: 'modified', changes };
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
  diff: endpointDiff,

  /**
   * v1 files spell the junction in column names and coerce an empty `summary`
   * to null; both are what the generated snapshot stopped doing. The chain's
   * LENGTH is checked against `payloadVersion` at registration, so this array
   * and the number in `index.ts` cannot drift apart. v2 → v3 adds `title`.
   */
  payloadUpgrades: [endpointPayloadV1ToV2, endpointPayloadV2ToV3],
} satisfies Pick<SerializationContribution<RawEntity>, 'payloadUpgrades' | 'diff'>;

/**
 * `link_dto` / `unlink_dto` as what the declaration already says they are:
 * sugar over the `linkedDtos` value collection.
 *
 * 2.0.0 tier K (item 58). `EndpointService.linkDto` wrote the `endpoint_dto`
 * junction with hand-rolled SQL — an `INSERT OR IGNORE` and two `DELETE`
 * variants — next to its own existence checks and its own `store.persist`. Every
 * one of those is something the host does for `linkedDtos` already, because the
 * field declares `collection: 'value'` with `keyFields: ['dto','relation',
 * 'statusCode']`. So the verb becomes: read the collection, add or drop one
 * entry, hand the whole array back to `genericUpdate`.
 *
 * Full-replace rather than a diff is not a compromise, it is the collection's
 * contract (`endpoint/schema.ts` says so). Idempotence, the FK to `dto`, the
 * `entity_version` capture and the file re-persist all come from that one write.
 */

import { DomainError } from '../../../host-kit/errors.js';
import type { EndpointDtoRelation } from '../../../types.js';

/** One entry of `linkedDtos`, in DECLARED field names (not junction columns). */
export interface DtoLink {
  dto: string;
  relation: EndpointDtoRelation;
  statusCode?: number | null;
}

/**
 * What these need from the host, narrowed to the calls actually made: the read
 * side, and ONE write — "store this whole collection". `update` is a callback
 * rather than the raw `ctx.crud` so the caller owns the `genericUpdate` shape
 * and this module stays about the merge rule.
 */
export interface LinkDtoDeps {
  reader: {
    getEntity(type: string, slug: string): unknown;
    readCollection(type: string, slug: string, field: string): unknown[];
  };
  update(slug: string, linkedDtos: DtoLink[]): void;
}

const RELATIONS = new Set<string>(['request', 'response', 'error']);

function normalizeStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function readLinks(deps: LinkDtoDeps, endpointSlug: string): DtoLink[] {
  if (!deps.reader.getEntity('endpoint', endpointSlug)) {
    throw new DomainError('NOT_FOUND', `endpoint '${endpointSlug}' not found`);
  }
  return deps.reader.readCollection('endpoint', endpointSlug, 'linkedDtos').map((row) => {
    const r = row as { dto?: unknown; relation?: unknown; statusCode?: unknown };
    return {
      dto: String(r.dto ?? ''),
      relation: r.relation as EndpointDtoRelation,
      statusCode: normalizeStatus(r.statusCode),
    };
  });
}

function sameLink(a: DtoLink, b: DtoLink): boolean {
  return (
    a.dto === b.dto &&
    a.relation === b.relation &&
    normalizeStatus(a.statusCode) === normalizeStatus(b.statusCode)
  );
}

/**
 * Add one link. Idempotent — re-linking an identical entry is a no-op write.
 *
 * The `relation` allowlist is now the field's `enum`, so the hand-written
 * `invalid relation` check is gone. The status-code rule is NOT: "a request body
 * has no status code" relates two fields to each other, which no single field's
 * declaration expresses, so it stays here as an explicit domain rule.
 */
export function linkDto(
  deps: LinkDtoDeps,
  endpointSlug: string,
  dtoSlug: string,
  relation: EndpointDtoRelation,
  statusCode: number | null = null,
): void {
  if (!RELATIONS.has(relation)) {
    throw new DomainError('VALIDATION', `invalid relation '${relation}'`);
  }
  if (relation === 'request' && statusCode !== null) {
    throw new DomainError('VALIDATION', 'request relation must not carry a status code');
  }
  if (!deps.reader.getEntity('dto', dtoSlug)) {
    throw new DomainError('NOT_FOUND', `dto '${dtoSlug}' not found`);
  }

  const links = readLinks(deps, endpointSlug);
  const next: DtoLink = { dto: dtoSlug, relation, statusCode: normalizeStatus(statusCode) };
  if (links.some((l) => sameLink(l, next))) return;
  deps.update(endpointSlug, [...links, next]);
}

/**
 * Drop one link. A null `statusCode` removes every entry for that
 * (dto, relation) pair — the documented behaviour of the retired route, and the
 * only way to unlink a `request` link, which never has one.
 */
export function unlinkDto(
  deps: LinkDtoDeps,
  endpointSlug: string,
  dtoSlug: string,
  relation: EndpointDtoRelation,
  statusCode: number | null = null,
): void {
  const links = readLinks(deps, endpointSlug);
  const status = normalizeStatus(statusCode);
  const kept = links.filter((l) => {
    if (l.dto !== dtoSlug || l.relation !== relation) return true;
    return status !== null && normalizeStatus(l.statusCode) !== status;
  });
  if (kept.length === links.length) return;
  deps.update(endpointSlug, kept);
}

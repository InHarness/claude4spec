import type { EntityRow, GetEntitiesResult } from '../../../server/discovery/index.js';
import { CliError } from '../errors.js';

/**
 * Unwrap a record off the wire.
 *
 * 0.2.23 emptied this of everything else. It used to append the serializer's
 * outcome flags (`_generic`, `_error`) to the payload, underscore-prefixed so
 * they could not collide with a declared field. Both described a fork between a
 * host-generated record and a type-computed one, and there is no longer a second
 * branch for them to point at — a marker every record carries identically is
 * noise on every record.
 */
export function unwrapEntity(record: { data?: unknown; entity?: unknown }): unknown {
  return 'entity' in record ? record.entity : record.data;
}

/**
 * Read one page of `list_entities` off the wire, for the exhaustive sweeps.
 *
 * `mode: 'count'` is the other arm of the result union and carries no `items`;
 * the sweeps never ask for it, and treating an absent `items` as the end of the
 * sweep rather than crashing is what keeps a surprising payload from taking the
 * command down mid-page.
 */
export function pickEntityPage(payload: unknown): {
  items: EntityRow[];
  hasMore: boolean;
} {
  /**
   * 0.2.22 — the row is `{ slug, title }` and carries no payload and no
   * serializer flags, so it is the answer rather than something to unwrap.
   * Running it through `unwrapEntity` — which reads `record.entity ?? record.data`
   * — printed a list of `null`s, a whole command emptied out by a shape change
   * one layer down.
   */
  const p = (payload ?? {}) as {
    items?: EntityRow[];
    hasMore?: boolean;
  };
  return { items: Array.isArray(p.items) ? p.items : [], hasMore: p.hasMore === true };
}

/**
 * One slug is the degenerate case of a slug LIST in the core, so the
 * single-entity commands unwrap it here — and turn "no such entity" back into
 * the CLI's `ENTITY_NOT_FOUND`, which the list-shaped operation reports as a
 * null row rather than an error.
 */
export function firstEntity(result: GetEntitiesResult, type: string, slug: string): unknown {
  const first = result.results[0];
  if (!first || first.entity === null) throw new CliError('ENTITY_NOT_FOUND', `${type}/${slug}`);
  return unwrapEntity(first);
}

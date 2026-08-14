import type { EntityRow, GetEntitiesResult, SerializedMeta } from '../../../server/discovery/index.js';
import { CliError } from '../errors.js';

/**
 * The CLI's own presentation of a serialized record: the payload, plus the
 * serializer's outcome flags underscore-prefixed so they cannot collide with a
 * field the entity itself declares.
 *
 * M39 — the flags now arrive from the discovery core rather than from a
 * `SerializeResult` the command built itself. The CLI is a transport: it
 * formats, it does not serialize.
 */
export function withMeta(record: { data?: unknown; entity?: unknown } & SerializedMeta): unknown {
  const data = 'entity' in record ? record.entity : record.data;
  if (!record.generic && !record.error) return data;
  if (typeof data === 'object' && data !== null) {
    return {
      ...(data as object),
      // The generic payload already carries `_generic` inside it (see
      // `serialization/generic.ts`); re-stating it here is what keeps the flag
      // present when the record came back generic for the other reason — the
      // type's own view threw and the host answered in its place.
      ...(record.generic ? { _generic: true } : {}),
      ...(record.error ? { _error: record.error } : {}),
    };
  }
  return data;
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
   * Running it through `withMeta` — which reads `record.entity ?? record.data`
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
  return withMeta(first);
}

import type { GetEntitiesResult, SerializedMeta } from '../../../server/discovery/index.js';
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
  if (!record.fallback && !record.error) return data;
  if (typeof data === 'object' && data !== null) {
    return {
      ...(data as object),
      ...(record.fallback ? { _fallback: true } : {}),
      ...(record.error ? { _error: record.error } : {}),
    };
  }
  return data;
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

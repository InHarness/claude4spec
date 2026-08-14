/**
 * M39 — `get_field_content`, the operation that hands over what a generic read
 * refuses to carry.
 *
 * A `contentBearing` field is excluded from every generic read on every surface;
 * what a caller gets instead is `has<Field>`, `<field>Bytes` and the NAME of
 * this operation. This is the other half of that bargain, and the host generates
 * it for every flagged field of every type — which is what makes the exclusion
 * honest rather than a way of losing data behind a flag.
 *
 * Keyed by a single coordinate, `(type, slug, field)`. That is the degenerate
 * case of the keyed-collection discipline: a spreadsheet's cells need a window
 * over two axes and get their own windowed operations, while a document body
 * needs one key and gets this.
 *
 * No side effects, and no write counterpart. The flag governs READS — content is
 * still written with an ordinary `update_entities` or `PATCH`.
 */

import { entityNotFound, invalidArgument, invalidType } from '../errors.js';
import { contentBytes, type FieldNode } from '../../../shared/plugin-host/data-schema.js';
import type { DiscoveryDeps, GetFieldContentInput, GetFieldContentResult } from '../types.js';

/** The fields under the flag for a type, for the error message and for `describe`. */
function contentFieldNames(schema: Readonly<Record<string, FieldNode>>): string[] {
  return Object.entries(schema)
    .filter(([, node]) => node.contentBearing)
    .map(([name]) => name);
}

export function getFieldContent(
  deps: DiscoveryDeps,
  input: GetFieldContentInput,
): GetFieldContentResult {
  const module = deps.host.getEntity(input.type);
  if (!module) throw invalidType(input.type, deps.host.listEntities().map((m) => m.type));

  const schema = module.data?.schema ?? {};
  const node = schema[input.field];
  /**
   * An unflagged field is `INVALID_ARGUMENT`, not `NOT_FOUND`, and the message
   * carries the list of fields that ARE under the flag.
   *
   * The distinction matters to a caller deciding what to do next: the entity is
   * fine and the request was wrong, so retrying the same call is pointless while
   * retrying with a different field name is exactly right. `NOT_FOUND` would
   * suggest the opposite.
   */
  if (!node?.contentBearing) {
    const covered = contentFieldNames(schema);
    throw invalidArgument(
      `'${input.field}' is not a content-bearing field of '${input.type}'`,
      covered.length
        ? `content-bearing fields of this type: ${covered.join(', ')}`
        : `'${input.type}' declares no content-bearing fields — read it with get_entities`,
    );
  }

  const raw = deps.reader.getEntity(input.type, input.slug);
  if (!raw) throw entityNotFound(input.type, input.slug, deps.reader.listSlugs(input.type));

  const value = raw.data[input.field] ?? raw.data[node.column ?? input.field];
  const content = typeof value === 'string' ? value : value == null ? '' : String(value);
  return {
    type: input.type,
    slug: input.slug,
    field: input.field,
    content,
    // Recomputed rather than read off a stored counter: the two would be free to
    // disagree, and the byte count a caller compares against the descriptor it
    // saw a moment ago has to be measuring the same string it just received.
    bytes: contentBytes(content),
  };
}

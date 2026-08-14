/**
 * M39 — `select`, the projection that replaced the `view` axis.
 *
 * The shape of a read used to be a closed list of variants each TYPE declared:
 * a caller asked for `detail` or `element_list_item` and got whatever that type
 * decided those meant. The shape of a read is now a function of the schema and
 * of what the CALLER asked for — `f(schema, select)` — computed here, once, for
 * every type at once.
 *
 * That is why this file has no per-type anything in it. It reads the flat key
 * set of `data.schema` and the flags on those keys, so a type contributed by a
 * plugin the host has never heard of projects by exactly the same rule as `ac`.
 * A projection function that had to learn about types would put the old problem
 * back one layer down.
 *
 * WHERE IT SITS: `serialize → project → budget`. After serialization, because a
 * projection cuts what has been produced rather than telling the producer what
 * to make; before the budget, because the budget's "first item is never
 * degraded" guarantee is a promise about the item the caller will actually
 * receive, and measuring it before the cut would measure something else.
 */

import {
  IDENTITY_FIELDS,
  RESERVED_TITLE_FIELD,
  contentBearingKeys,
  contentBytes,
  contentOperationOf,
  selectableFieldsOf,
  type FieldNode,
} from '../../shared/plugin-host/data-schema.js';
import { invalidArgument } from './errors.js';

type Schema = Readonly<Record<string, FieldNode>>;

/**
 * Reject a `select` this host cannot honour, and say what it could have been.
 *
 * ONE LEVEL ONLY, and the reason is semantic rather than transport. A
 * `collection: 'value'` is declared opaque — it is read whole and replaced whole
 * — so answering `columns[].name` would hand back a piece of something the
 * declaration says has no pieces. A type that wants partial reads of a
 * collection declares it `'keyed'` and gets a windowed operation instead.
 *
 * The message carries the flat list of legal names rather than just refusing.
 * It is the same list `describe_*` publishes as `selectableFields`, so a caller
 * that guessed wrong can fix the call from the error alone.
 */
export function validateSelect(select: readonly string[] | undefined, schema: Schema): void {
  if (!select) return;
  /**
   * The identity names are legal INPUT as well as guaranteed output.
   *
   * They are not schema fields — `slug` and `tags` live on the envelope — so a
   * schema-derived list left them out, and the envelope's own `selectedFields`
   * echo could not be handed straight back as a `select`. Refusing the exact
   * shape a caller was just told it received is the kind of asymmetry nobody
   * reads a doc to discover. Naming them changes nothing about the answer: they
   * survive every projection either way.
   */
  const legal = [...new Set([...IDENTITY_FIELDS, ...selectableFieldsOf(schema)])];
  for (const name of select) {
    const bad =
      typeof name !== 'string' || name.includes('.') || name.includes('[') || !legal.includes(name);
    if (!bad) continue;
    throw invalidArgument(
      `select does not descend into nested values; name a top-level field (got ${JSON.stringify(name)})`,
      `legal names for this type: ${legal.join(', ')}`,
    );
  }
}

/**
 * Cut a serialized record down to what the caller asked for.
 *
 * The four cases of the contract, in one place:
 *
 *   - `select` ABSENT — every schema field except the content-bearing ones. The
 *     useful default: everything that travels cheaply.
 *   - `select: []` — the identity skeleton alone. Not an empty answer: `slug`,
 *     `title` and `tags` are what a caller needs to render a link, and asking
 *     for nothing else is a legitimate, and cheap, request.
 *   - `select: ['a','b']` — those fields, plus identity.
 *   - a CONTENT-BEARING name in `select` — not an error, and deliberately so.
 *     The reply is the field's descriptor plus the operation that will hand over
 *     the content, which tells the caller what to do next; a refusal would only
 *     tell them they were wrong.
 *
 * Identity fields survive every case because they do not come from `data` — they
 * come from the envelope around it. A projection cannot remove the row's own
 * identity, and a caller never has to remember to ask for it.
 */
export function project(
  data: unknown,
  select: readonly string[] | undefined,
  schema: Schema,
  /**
   * The stored row, for the one thing a serialized payload cannot always
   * supply: the SIZE of a content-bearing field.
   *
   * A host-generated payload already carries `has<Field>`/`<field>Bytes`, but a
   * type that computes its own views has no reason to — and correctly does not,
   * since the field is excluded from them. Reading the raw column here is what
   * makes the descriptor identical whichever of the two produced the record.
   */
  stored?: Record<string, unknown>,
  /**
   * The type's web-UI path prefix (`/acs`, `/endpoints`), from the manifest.
   *
   * `href` is an identity field the HOST generates — `${pathPrefix}/${slug}` —
   * rather than a field of the schema, which is why it is passed in here rather
   * than read out of the record. It was the one thing the retired per-type
   * `inline_mention` views contributed that a projection over the schema could
   * not reproduce, and without it a chip renders as a bold label where it used
   * to render as a link. An informational origin link, not a promise that a
   * server is listening on it.
   */
  pathPrefix?: string,
): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  const row = data as Record<string, unknown>;
  const wanted = select ? new Set(select) : null;

  const out: Record<string, unknown> = {};
  // Identity first, so it is present even for a type whose serialized payload
  // omitted one of them — and in a stable position in the emitted object.
  for (const key of IDENTITY_FIELDS) {
    if (key in row) out[key] = row[key];
  }
  // `type` and the `_generic` / `_error` markers are envelope facts about the
  // record, not fields of it. They survive projection for the same reason
  // identity does: a consumer that cannot tell a host-shaped row from a
  // type-computed one will read the second as the first.
  for (const key of ['type', '_generic', '_type', '_error', '_brokenRefs']) {
    if (key in row) out[key] = row[key];
  }
  // Host-generated, so it survives every projection alongside the other
  // identity fields — including `select: []`, where a link is most of the point.
  const slug = out.slug ?? row.slug;
  if (pathPrefix && typeof slug === 'string') out.href = `${pathPrefix}/${slug}`;

  for (const [name, node] of Object.entries(schema)) {
    if (node.transientInput || node.localSurrogate) continue;
    if (wanted && !wanted.has(name)) continue;
    if (IDENTITY_FIELDS.includes(name as (typeof IDENTITY_FIELDS)[number])) continue;

    if (node.contentBearing) {
      /**
       * The descriptor, whether or not the caller named the field.
       *
       * `has`/`bytes` may already be present — the generic payload builder emits
       * them — but a type computing its own views need not, and the answer must
       * not depend on which of those produced the row. Recomputing from the
       * value when it is still there, and trusting the emitted keys when it is
       * not, makes both paths agree.
       */
      const keys = contentBearingKeys(name);
      const source = name in row ? row[name] : stored?.[name] ?? stored?.[node.column ?? name];
      const bytes = source !== undefined ? contentBytes(source) : Number(row[keys.bytes] ?? 0);
      out[keys.has] = bytes > 0;
      out[keys.bytes] = bytes;
      out[`${name}Operation`] = contentOperationOf(node);
      continue;
    }

    if (name in row) out[name] = row[name];
  }

  /**
   * With NO `select`, keys the type computed but the schema never declared
   * survive: `dto.endpoints` (a reverse join), `ac.brokenVerifies`,
   * `_references`.
   *
   * The strict reading of "every schema field" would drop them, and that reading
   * costs real behaviour — the DTO detail page reads `endpoints.length`, and it
   * threw on load the last time a read stopped carrying it. So the default is
   * "the record as the host produced it, minus what is content-bearing", which
   * is what a caller who asked for no particular shape means.
   *
   * A caller who DOES name fields gets exactly those: they asked for a shape, so
   * a computed extra riding along would be the same surprise in the other
   * direction. Such a key is also not `select`-able, since `selectableFields`
   * comes from the schema — reported to the spec author as a clarification.
   */
  if (!wanted) {
    for (const [key, value] of Object.entries(row)) {
      if (key in out || key in schema) continue;
      out[key] = value;
    }
  }

  return out;
}

/**
 * The fields a projected record actually carries, echoed in the envelope.
 *
 * Symmetric to `searchedFields`, and there for the same reason: without it a
 * NARROW record is indistinguishable from an entity that happens to hold little
 * data, and a consumer reading the first as the second reports fields as absent
 * that were merely not requested.
 */
export function selectedFieldsOf(select: readonly string[] | undefined, schema: Schema): string[] {
  const identity = [...IDENTITY_FIELDS];
  if (select) return [...new Set([...identity, ...select])];
  return [
    ...new Set([
      ...identity,
      ...selectableFieldsOf(schema).filter((name) => !schema[name]?.contentBearing),
    ]),
  ];
}

/** True when the schema declares the reserved title — every registered type does. */
export function hasTitle(schema: Schema): boolean {
  return RESERVED_TITLE_FIELD in schema;
}

/**
 * Host API 2.0.0 — JSON Schema DERIVED FROM the logical schema.
 *
 * 0.2.9 (tier B, item 9) retired the two-path emission this replaces: a type
 * either shipped a hand-written `serializer.schema(view)` — a fourth description
 * of the same field set — or got nothing but reflection over its SQLite columns,
 * stamped `_auto: true` and documented as "best-effort ~90%". Neither path could
 * see a `record` node's key schema, and the reflection path could not run at all
 * without a db handle. Both are gone: `data.schema` is the one description, and
 * everything a consumer is told about a type's shape is derived from it.
 *
 * Pure data in, pure data out, and therefore in `shared/` rather than `server/`:
 * the client's form generation is the obvious second consumer, and it must not
 * pull in `better-sqlite3` to learn what a field looks like.
 */

import type { DataDeclaration, FieldNode } from './data-schema.js';
import { columnOf, contentBearingKeys, isEmbedded } from './data-schema.js';

export type JsonSchema = Record<string, unknown>;

/**
 * One field node → JSON Schema.
 *
 * Exported on its own because the CRUD input schemas (item 27) derive from the
 * same nodes with different flag handling — create wants `required`, update
 * wants the `clearable` null-union — and both should share this mapping rather
 * than grow a second one.
 */
export function nodeSchema(node: FieldNode): JsonSchema {
  const base = baseSchema(node);
  // `clearable` is the ONLY declared source of a nullable union: it is the flag
  // that says "an update may set this to null", which is exactly "null is in the
  // domain".
  return node.clearable ? withNull(base) : base;
}

/**
 * Admit `null` into a schema — including into a closed `enum` list.
 *
 * Widening `type` alone was wrong for an enum: `{type: ['string','null'], enum:
 * ['active','deprecated']}` accepts the null by its type and then rejects it by
 * its enum, so the one value the declaration explicitly permits is the one value
 * the schema cannot express.
 */
function withNull(schema: JsonSchema): JsonSchema {
  const widened: JsonSchema = { ...schema, type: nullable(schema.type) };
  if (Array.isArray(schema.enum)) widened.enum = [...schema.enum, null];
  return widened;
}

function baseSchema(node: FieldNode): JsonSchema {
  switch (node.kind) {
    case 'string':
      // 0.2.22 — the value constraint travels into the derived schema, so a
      // caller reading `describe_entity_type` sees the same bound the write path
      // enforces rather than discovering it from a rejection.
      return node.maxLength === undefined
        ? { type: 'string' }
        : { type: 'string', maxLength: node.maxLength };
    case 'number':
    case 'boolean':
      return { type: node.kind };
    case 'enum':
      return { type: 'string', enum: [...node.values] };
    case 'object':
      return objectSchema(node.fields, (name) => name);
    case 'collection':
      return { type: 'array', items: nodeSchema(node.item) };
    case 'record':
      // The branch the old reflection deriver could not see at all: a map's key
      // schema is declared, so `propertyNames` is derivable instead of guessed.
      return {
        type: 'object',
        propertyNames: nodeSchema(node.key),
        additionalProperties: nodeSchema(node.value),
      };
    case 'json':
      // Deliberately `{}` and not `{type: [...every type...]}`: an opaque value
      // is one the declaration says nothing about, and enumerating the JSON
      // types would be saying something. `withNull` on a `{}` is also a no-op,
      // which is correct — null is already in the domain.
      return {};
  }
}

function nullable(type: unknown): unknown {
  if (typeof type === 'string') return [type, 'null'];
  return type;
}

/**
 * A field a READ payload can never carry.
 *
 * `transientInput` feeds the slug and is never persisted; `localSurrogate` is
 * index-only. `systemManaged` is the one this file got wrong at first: the
 * `createdAt`/`updatedAt` pair is declared like any other field, but
 * `RawEntityReader.hydrate` lifts it OUT of `entity.data` into a separate
 * `system` slot, and no computed view emits it either. Describing it as a
 * property — let alone a required one — advertised a contract every single
 * response violates. The reflection deriver this replaced skipped the same three
 * columns by name (`id`, `created_at`, `updated_at`); the rule is the same one,
 * now read off the declaration instead of off the table.
 */
function readable(node: FieldNode): boolean {
  return !node.transientInput && !node.localSurrogate && !node.systemManaged;
}

/** `required` in the JSON Schema sense: the payload always carries it. */
function alwaysPresent(node: FieldNode): boolean {
  return !!node.required || node.default != null || node.computedDefault != null;
}

function objectSchema(
  fields: Readonly<Record<string, FieldNode>>,
  keyOf: (name: string, node: FieldNode) => string,
  /**
   * Generic-view mode. The payload is a projection ROW, so it carries a key for
   * every embedded column — including the ones holding SQL NULL — and carries no
   * key at all for a collection that projects to its own table.
   */
  row?: boolean,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [name, node] of Object.entries(fields)) {
    if (!readable(node)) continue;
    // A collection with its own table (`endpoint.linkedDtos` → `endpoint_dto`)
    // is not on the row the generic payload spreads, so a closed schema must not
    // claim it. A computed view may well resolve it, which is why this only
    // applies in row mode.
    if (row && !isEmbedded(node)) continue;
    // 0.2.19 — a `contentBearing` field is excluded from the view and described
    // by its two derived keys instead. Both are always present: the host emits
    // them for every row, including one whose content is absent (`false` / `0`).
    if (node.contentBearing) {
      const derived = contentBearingKeys(name);
      properties[derived.has] = { type: 'boolean' };
      properties[derived.bytes] = { type: 'integer' };
      required.push(derived.has, derived.bytes);
      continue;
    }
    const key = keyOf(name, node);
    const present = alwaysPresent(node);
    // In row mode an optional field is still PRESENT, holding null — the column
    // exists and `hydrate` copies every column. So its type has to admit null,
    // or every entity with an unset optional field fails its own schema.
    properties[key] = row && !present ? withNull(nodeSchema(node)) : nodeSchema(node);
    if (present) required.push(key);
  }
  return { type: 'object', properties, required };
}

export interface RecordSchemaArgs {
  type: string;
  data: DataDeclaration;
}

/**
 * The schema of a type's READ RECORD — one per type, and the only one.
 *
 * Until 0.2.23 this took a `view` and had two shapes behind it. The GENERIC one
 * described what the host built; the COMPUTED one described what a type's own
 * view function might emit, and had to be open and `required`-less precisely
 * because the host could not read that function. With no author code left in the
 * read path, the second shape has nothing to describe: every record comes out of
 * `genericEntity`, so the schema is CLOSED and exact for every type alike.
 *
 * Property names are the DECLARED field names. They used to be projection COLUMN
 * names here, which stopped being true when `genericEntity` started re-keying
 * the hydrated row through `byFieldName` — a type like `ui-view` was serving
 * `designSystemSlug` while this schema promised `design_system_slug`. The
 * declaration is the contract on both sides now.
 *
 * This schema describes the record BEFORE projection. A caller's `select`
 * narrows what arrives; `selectableFields` on `describe_types` is what says
 * which names may be narrowed to.
 */
export function recordSchema({ type, data }: RecordSchemaArgs): JsonSchema {
  const fields = objectSchema(data.schema, (name) => name, true);
  return {
    type: 'object',
    properties: {
      type: { const: type },
      slug: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      ...(fields.properties as Record<string, JsonSchema>),
    },
    required: ['type', 'slug', 'tags', ...(fields.required as string[])],
    additionalProperties: false,
  };
}

/**
 * Dotted paths of the text-bearing leaves of a declaration.
 *
 * Not wired to anything yet — `discovery/search/fields.ts` still derives its
 * searchable paths from the CRUD zod schemas, and moving it is item 26 (tier D).
 * This is the target it moves to, exported here so the two derivations end up in
 * one module rather than two.
 */
export function searchablePaths(data: DataDeclaration): string[] {
  const paths: string[] = [];
  const walk = (fields: Readonly<Record<string, FieldNode>>, prefix: string): void => {
    for (const [name, node] of Object.entries(fields)) {
      if (!readable(node)) continue;
      const path = prefix ? `${prefix}.${name}` : name;
      // `json` carries its own path and no children — same rule, and the same
      // reason, as `discovery/search/fields.ts`: an opaque value may hold a
      // string, and the host cannot name a path inside one.
      if (node.kind === 'string' || node.kind === 'enum' || node.kind === 'json') paths.push(path);
      else if (node.kind === 'object') walk(node.fields, path);
      else if (node.kind === 'collection' && node.item.kind === 'object') walk(node.item.fields, `${path}[]`);
      else if (node.kind === 'collection' && node.item.kind === 'string') paths.push(`${path}[]`);
      else if (node.kind === 'record' && node.value.kind === 'object') walk(node.value.fields, `${path}.$value`);
    }
  };
  walk(data.schema, '');
  return paths;
}

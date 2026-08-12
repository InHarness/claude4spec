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

/** The five read views. Mirrors `ViewKind` in the server's serialization types. */
export type ViewName =
  | 'inline_mention'
  | 'single_element'
  | 'element_list_item'
  | 'tagged_list_item'
  | 'detail';

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

export interface ViewSchemaArgs {
  type: string;
  data: DataDeclaration;
  view: ViewName;
  /**
   * Whether the type declares a computed view for this view kind. The two cases
   * are genuinely different contracts, not a formatting detail — see below.
   */
  computed: boolean;
}

/**
 * The schema of one type × one view.
 *
 * Two shapes, because there are two kinds of view since "generic is the rule":
 *
 *   - GENERIC (`computed: false`) — the host builds the payload itself, from the
 *     projection row plus the `_generic`/`_type`/`_view` markers. The schema is
 *     therefore CLOSED (`additionalProperties: false`) and exact. Its property
 *     names are PROJECTION COLUMN names, because that is literally what the
 *     generic payload spreads (`snakeCase` unless the field declared `column`).
 *   - COMPUTED (`computed: true`) — the payload comes out of a function the host
 *     cannot introspect, and the real ones are SELECTIVE: `ac.inline_mention`
 *     answers `{type, slug, label, href}` out of eight declared fields, while
 *     `detail` adds `_references` and resolved refs that no declaration mentions.
 *     So the schema is open, carries NO `required` list, and is marked
 *     `x-computed`: it says what a field is named and shaped WHEN it appears,
 *     never that it appears. Property names here are the DECLARED field names,
 *     which is what a computed view emits.
 *
 * The naming split is a consequence of the generic payload still being column-
 * keyed; it is described here rather than papered over, because a schema that
 * lies about its key names is worse than one that explains itself.
 */
export function viewSchema({ type, data, view, computed }: ViewSchemaArgs): JsonSchema {
  const fields = objectSchema(
    data.schema,
    computed ? (name) => name : (name, node) => columnOf(name, node),
    !computed,
  );
  const properties: Record<string, JsonSchema> = {
    type: { const: type },
    slug: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    ...(fields.properties as Record<string, JsonSchema>),
  };
  if (computed) {
    /**
     * NO `required` list, deliberately.
     *
     * A computed view builds its payload in a function the host cannot read, and
     * the real ones emit a SMALL selection of the declared fields —
     * `ac.inline_mention` answers `{type, slug, label, href}` out of eight
     * declared fields. Deriving `required` from the declaration therefore
     * published a contract every genuine response violated. The declared fields
     * remain as a FLOOR of what may appear, which is all the declaration can
     * honestly say; `type` and `slug` are not required here either, for the same
     * reason — nothing forces a computed view to emit them.
     */
    return { type: 'object', properties, additionalProperties: true, 'x-computed': true };
  }
  return {
    type: 'object',
    properties: {
      ...properties,
      _generic: { const: true },
      _type: { const: type },
      _view: { const: view },
    },
    required: ['type', 'slug', 'tags', ...(fields.required as string[]), '_generic', '_type', '_view'],
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

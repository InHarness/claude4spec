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
import { columnOf } from './data-schema.js';

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
  // `clearable` is the ONLY source of a nullable union: it is the flag that says
  // "an update may set this to null", which is exactly "null is in the domain".
  return node.clearable ? { ...base, type: nullable(base.type) } : base;
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
  }
}

function nullable(type: unknown): unknown {
  if (typeof type === 'string') return [type, 'null'];
  return type;
}

/** A field a READ payload can never carry: an input that never lands, or an index-only column. */
function readable(node: FieldNode): boolean {
  return !node.transientInput && !node.localSurrogate;
}

/** `required` in the JSON Schema sense: the payload always carries it. */
function alwaysPresent(node: FieldNode): boolean {
  return !!node.required || node.default != null || node.computedDefault != null;
}

function objectSchema(
  fields: Readonly<Record<string, FieldNode>>,
  keyOf: (name: string, node: FieldNode) => string,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [name, node] of Object.entries(fields)) {
    if (!readable(node)) continue;
    const key = keyOf(name, node);
    properties[key] = nodeSchema(node);
    if (alwaysPresent(node)) required.push(key);
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
 *     cannot introspect. Every computed view in the repo emits the declared
 *     fields plus extras (`_references`, resolved DTOs, counts), so the declared
 *     field set is an honest FLOOR and nothing more: the schema stays open and
 *     is marked `x-computed` so a consumer can tell "what the type declares" from
 *     "what you will actually get". Property names here are the DECLARED field
 *     names, which is what a computed view emits.
 *
 * The naming split is a consequence of the generic payload still being column-
 * keyed; it is described here rather than papered over, because a schema that
 * lies about its key names is worse than one that explains itself.
 */
export function viewSchema({ type, data, view, computed }: ViewSchemaArgs): JsonSchema {
  const fields = objectSchema(data.schema, computed ? (name) => name : (name, node) => columnOf(name, node));
  const properties: Record<string, JsonSchema> = {
    type: { const: type },
    slug: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    ...(fields.properties as Record<string, JsonSchema>),
  };
  const required = ['type', 'slug', 'tags', ...(fields.required as string[])];
  if (computed) {
    return { type: 'object', properties, required, additionalProperties: true, 'x-computed': true };
  }
  return {
    type: 'object',
    properties: {
      ...properties,
      _generic: { const: true },
      _type: { const: type },
      _view: { const: view },
    },
    required: [...required, '_generic', '_type', '_view'],
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
      if (!readable(node) || node.systemManaged) continue;
      const path = prefix ? `${prefix}.${name}` : name;
      if (node.kind === 'string' || node.kind === 'enum') paths.push(path);
      else if (node.kind === 'object') walk(node.fields, path);
      else if (node.kind === 'collection' && node.item.kind === 'object') walk(node.item.fields, `${path}[]`);
      else if (node.kind === 'collection' && node.item.kind === 'string') paths.push(`${path}[]`);
      else if (node.kind === 'record' && node.value.kind === 'object') walk(node.value.fields, `${path}.$value`);
    }
  };
  walk(data.schema, '');
  return paths;
}

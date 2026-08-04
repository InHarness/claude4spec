/**
 * Host API 2.0.0, item 27 — the CRUD INPUT schemas, derived from `data.schema`.
 *
 * The last of the four hand-written descriptions of one field set. A type used
 * to ship its own DDL (`backend.migrations`), its own snapshot/restore, its own
 * search scope and its own `backend.crud.{createSchema,updateSchema}` — six
 * `crud-schemas.ts` files that nothing checked against the table, the payload or
 * each other. They are now generated, so the validator a write passes through
 * and the projection it lands in cannot disagree.
 *
 * WHY ZOD AND NOT `json-schema.ts`. `nodeSchema` there answers "what does this
 * field look like" for a reader; this answers "may this payload be written",
 * which needs a validator with a parse step. The two mappings are kept
 * field-for-field consistent by `crud-schema-gen.test.ts`, which walks both over
 * the same declaration — one description, two encodings, and a test that says so.
 *
 * THE THREE FLAG RULES, and nothing else:
 *   - a field is in the CREATE shape unless it is `systemManaged` (the host
 *     writes it) or `localSurrogate` (the index owns it);
 *   - a field is REQUIRED on create only when nothing can fill it — `required`
 *     with no `default` and no `computedDefault`. `diagram.format` is
 *     `required: true, default: 'mermaid'`, and the retired hand-written schema
 *     had it optional for exactly this reason;
 *   - `clearable` is the only source of a `null` arm (the tri-state), and
 *     `transientInput` is create-only — it seeds the slug, and a slug is
 *     computed once.
 */

import { z } from 'zod';
import type { ZodRawShape, ZodTypeAny } from 'zod';
import type { DataDeclaration, FieldNode } from '../../../shared/plugin-host/data-schema.js';

/**
 * The shape UNDER construction. `ZodRawShape` is `Readonly`, so it is the
 * return type, never the accumulator.
 */
type MutableShape = Record<string, ZodTypeAny>;

/** One field node → one zod type. Flags are applied by the callers below. */
function nodeType(node: FieldNode): ZodTypeAny {
  switch (node.kind) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'enum':
      return z.enum([...node.values] as [string, ...string[]]);
    case 'object':
      return z.object(shapeOf(node.fields));
    case 'collection':
      return z.array(nodeType(node.item));
    case 'record':
      /**
       * The cast is the declaration's own guarantee, not a hole: a JSON object
       * key is a string, so a `record` whose key node is anything else is a
       * schema `data-schema-validation` rejects. Zod's key parameter is typed
       * against `string | number | symbol` and cannot see that.
       */
      return z.record(nodeType(node.key) as z.ZodType<string>, nodeType(node.value));
    case 'json':
      return z.unknown();
  }
}

/**
 * A NESTED object's shape — item fields, group fields, param fields.
 *
 * Different rules from the top level on purpose. `required` is literal here
 * (there is no create/update split inside a collection item: the whole
 * collection is replaced wholesale), and none of the top-level exclusions
 * apply — a nested `createdAt` would be a field of the item, not an audit stamp
 * the host writes.
 */
function shapeOf(fields: Readonly<Record<string, FieldNode>>): MutableShape {
  const shape: MutableShape = {};
  for (const [name, node] of Object.entries(fields)) {
    let t = nodeType(node);
    if (node.clearable) t = t.nullable();
    if (!node.required) t = t.optional();
    shape[name] = node.description ? t.describe(node.description) : t;
  }
  return shape;
}

/** Excluded from BOTH input shapes: the host writes these, a caller never does. */
function callerSupplied(node: FieldNode): boolean {
  return !node.systemManaged && !node.localSurrogate;
}

/**
 * `slug` and `tags` are on every shape because they are HOST fields, not fields
 * of any type: identity and the M19 tag layer, which no `data.schema` declares.
 * `slug` is create-only — a rename travels as the `newSlug` SIBLING of `data` on
 * an `update_entities` item, never nested inside it.
 */
const SLUG_INPUT = z
  .string()
  .optional()
  .describe('Explicit slug; otherwise derived from the type\'s slugPattern. Collisions get a -2/-3 suffix.');
const TAGS_INPUT = z
  .array(z.string())
  .optional()
  .describe('Tag slugs; non-existent tags are auto-created.');

/** The `create_entities` input shape for a type. */
export function buildCreateShape(data: DataDeclaration): ZodRawShape {
  const shape: MutableShape = {};
  for (const [name, node] of Object.entries(data.schema)) {
    if (!callerSupplied(node)) continue;
    let t = nodeType(node);
    if (node.clearable) t = t.nullable();
    // A default or a computedDefault fills an absent field, so demanding it
    // would reject a payload the declaration says is complete.
    if (!node.required || node.default !== undefined || node.computedDefault !== undefined) {
      t = t.optional();
    }
    shape[name] = node.description ? t.describe(node.description) : t;
  }
  shape.slug = SLUG_INPUT;
  shape.tags = TAGS_INPUT;
  return shape;
}

/**
 * The `update_entities` `data` shape for a type.
 *
 * The tri-state, in three lines: every field optional (omitted = no change),
 * `null` admitted only where `clearable` says it may be (clear), a value
 * replaces. A `transientInput` field is absent entirely — it exists to seed the
 * slug at create, and there is nothing for it to do in an update.
 */
export function buildUpdateShape(data: DataDeclaration): ZodRawShape {
  const shape: MutableShape = {};
  for (const [name, node] of Object.entries(data.schema)) {
    if (!callerSupplied(node) || node.transientInput) continue;
    let t = nodeType(node);
    if (node.clearable) t = t.nullable();
    t = t.optional();
    shape[name] = node.description ? t.describe(node.description) : t;
  }
  shape.tags = TAGS_INPUT;
  return shape;
}

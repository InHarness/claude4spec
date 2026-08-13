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
import type { DataDeclaration, FieldNode, ScalarNode } from '../../../shared/plugin-host/data-schema.js';
import { SQL_RESERVED_WORDS } from '../../../shared/plugin-host/sql-reserved-words.js';
import type { SlugPattern, SlugStep } from '../../../shared/plugin-host/slug-pattern.js';

/**
 * The shape UNDER construction. `ZodRawShape` is `Readonly`, so it is the
 * return type, never the accumulator.
 */
type MutableShape = Record<string, ZodTypeAny>;

/**
 * The string leaf's own constraints.
 *
 * Extracted rather than inlined into `nodeType` because `nonBlankIfSlugSource`
 * has to be able to rebuild exactly this and add to it: the field a type
 * slugifies is a string leaf like any other, and before this existed the
 * slug-source branch replaced it wholesale.
 *
 * Order is checks-only, so it does not affect what is accepted — but it does
 * decide which message a caller sees first, and "must match …" before "is a
 * reserved SQL word" reads in the order an author fixes them.
 */
function stringType(node: ScalarNode): z.ZodString {
  let out = z.string();
  if (node.maxLength !== undefined) {
    /**
     * 0.2.22 — the value constraint, enforced HERE and nowhere else.
     *
     * On the write path only: a read never checks a length and never shortens a
     * value it was handed. Refusing rather than truncating is the whole point —
     * a silently shortened title is data loss the author never sees, while a
     * `VALIDATION_ERROR` names the field and the bound.
     */
    out = out.max(node.maxLength, `must be at most ${node.maxLength} characters`);
  }
  if (node.pattern !== undefined) {
    /**
     * Compiled per generated schema, not per parse. `data-schema-validation`
     * has already refused an uncompilable pattern at registration, so this
     * cannot be the throw site.
     */
    out = out.regex(new RegExp(node.pattern), `must match ${node.pattern}`);
  }
  if (node.notReserved === 'sql') {
    out = out.refine((v) => !SQL_RESERVED_WORDS.has(v.toLowerCase()), {
      error: (iss) => `"${String(iss.input)}" is a reserved SQL word`,
      params: { code: 'RESERVED_TABLE_NAME' },
    }) as unknown as z.ZodString;
  }
  return out;
}

/** One field node → one zod type. Flags are applied by the callers below. */
function nodeType(node: FieldNode): ZodTypeAny {
  switch (node.kind) {
    case 'string':
      return stringType(node);
    case 'number': {
      /**
       * The numeric bounds a declaration may carry. Applied here rather than
       * only as a SQL `CHECK` because the two answer differently: a CHECK
       * surfaces as a driver error the REST layer renders `500 INTERNAL`, while
       * a zod refusal is the `400 VALIDATION` a caller can act on.
       */
      let out = z.number();
      if (node.integer) out = out.int();
      if (node.min !== undefined) out = out.min(node.min);
      if (node.max !== undefined) out = out.max(node.max);
      return out;
    }
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

/**
 * A field the SLUG is derived from must not be blank.
 *
 * The six retired services each opened with a hand-written `if (!x) throw
 * VALIDATION` — `AcService` on `text`, `EndpointService` on `path`. Tier K
 * deleted them on the reading that `required` says the same thing, and it does
 * not: `z.string()` accepts `''` and the projection's required check only fires
 * on `null`/absent.
 *
 * But `required` is the wrong test for it, and trying that first is what caught
 * this: `endpoint.summary` is `required: true, default: ''`, so a blanket
 * non-blank rule on required strings rejects a legitimately empty summary. What
 * the retired services actually guarded was narrower and has a reason —
 * `text` and `path` are what their `slugPattern` SLUGIFIES.
 *
 * That is the invariant: a blank slug source produces a degenerate slug.
 * `POST /api/acs {"text": ""}` slugified to nothing and left the bare literal
 * prefix `ac-` — non-empty, so slug allocation accepted it — producing a blank
 * AC that shows as an empty row in the list and in every agent's active-AC set.
 * The next such create then failed with `SLUG_CONFLICT: ac slug 'ac-' already
 * exists`, which tells the author nothing about what they did wrong.
 *
 * `\S` rather than `.min(1)`: whitespace slugifies to nothing exactly as `''`
 * does, so length is the wrong question. Validation only — no `.trim()`, which
 * would TRANSFORM the value and quietly rewrite what the caller sent.
 */
function slugSourceFields(pattern: SlugPattern | undefined): Set<string> {
  const fields = new Set<string>();
  if (!pattern || pattern.length === 0) return fields;

  /**
   * A FALLBACK CHAIN exempts everything in it.
   *
   * `SlugPattern` is either one step list or an ordered list of alternatives,
   * and the chain exists precisely so a blank source is survivable: `diagram` is
   * `slugify(caption)` → `slugify(firstSourceIdentifier)` → `nanoid(8)`, so a
   * captionless diagram is not a mistake, it is the case alternative two and
   * three are for. Only a single-alternative pattern has no recovery, and only
   * there does a blank source degenerate into the bare literal prefix.
   */
  const alternatives = Array.isArray(pattern[0]) ? (pattern as SlugStep[][]) : [pattern as SlugStep[]];
  if (alternatives.length > 1) return fields;

  for (const step of alternatives[0] ?? []) {
    if (step.op === 'slugify') fields.add(step.field);
  }
  return fields;
}

/**
 * COMPOSES onto the derived type; it does not replace it.
 *
 * It used to return a bare `z.string().regex(/\S/)`, which discarded everything
 * `nodeType` had derived for the field. Harmless while a string leaf carried no
 * flags — and a silent hole the moment one did, because the field a type
 * SLUGIFIES is the field most likely to constrain: it is the entity's name.
 * A leaf declaring both would have its own rule accepted at registration and
 * enforced nowhere.
 *
 * `t` is `nodeType(node)`'s output, which for `kind: 'string'` is always a
 * `ZodString`, so `.regex()` chains off it — that is what makes the composition
 * possible at all rather than needing a wrapper.
 */
function nonBlankIfSlugSource(name: string, node: FieldNode, sources: Set<string>, t: ZodTypeAny): ZodTypeAny {
  return node.kind === 'string' && sources.has(name)
    ? (t as z.ZodString).regex(/\S/, 'must not be blank')
    : t;
}

/** The `create_entities` input shape for a type. */
export function buildCreateShape(data: DataDeclaration, slugPattern?: SlugPattern): ZodRawShape {
  const sources = slugSourceFields(slugPattern);
  const shape: MutableShape = {};
  for (const [name, node] of Object.entries(data.schema)) {
    if (!callerSupplied(node)) continue;
    let t = nonBlankIfSlugSource(name, node, sources, nodeType(node));
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
export function buildUpdateShape(data: DataDeclaration, slugPattern?: SlugPattern): ZodRawShape {
  const sources = slugSourceFields(slugPattern);
  const shape: MutableShape = {};
  for (const [name, node] of Object.entries(data.schema)) {
    if (!callerSupplied(node) || node.transientInput) continue;
    // Same rule on update. The slug is not recomputed, but the FIELD is still
    // what the entity is named after, and blanking it is the write create refuses.
    let t = nonBlankIfSlugSource(name, node, sources, nodeType(node));
    if (node.clearable) t = t.nullable();
    t = t.optional();
    shape[name] = node.description ? t.describe(node.description) : t;
  }
  shape.tags = TAGS_INPUT;
  return shape;
}

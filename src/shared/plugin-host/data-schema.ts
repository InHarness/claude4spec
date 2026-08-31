/**
 * Host API 2.0.0 — the LOGICAL SCHEMA an entity type declares.
 *
 * Before this, a type shipped its own DDL (`backend.migrations`), its own slug
 * function (`slugFrom`), its own MCP input schemas (`backend.crud.*`) and its
 * own snapshot/restore. Four descriptions of the same field set, kept in sync by
 * hand, each free to drift from the others. A type now declares its fields ONCE
 * and the host derives the rest: the SQLite projection, the CRUD input schemas,
 * the searchable paths, snapshot/restore, and rename propagation.
 *
 * Everything here is PURE DATA — no imports outside `shared/`, no functions on
 * the manifest. That is what lets the same declaration be read by the server
 * (projection, write path), the client (form generation) and the CLI (doctor)
 * without any of them pulling in the others' runtime.
 *
 * INVARIANT OF PROJECTION (inherited from `./composition.ts`): every non-surrogate
 * column of every generated table must be reproducible from the entity files.
 * Dropping the index and rebuilding from `entitiesDir` yields value-identical
 * rows. A field that cannot satisfy that is `localSurrogate` and is excluded
 * from both the snapshot and the rebuild comparison.
 */

import type { SlugPattern } from './slug-pattern.js';
import { describeValidator, type ValidatorKind } from './named-validators.js';

/**
 * Flags carried by every field node.
 *
 * The set is closed. A flag here is one the HOST acts on — adding one is a Host
 * API change, precisely because some layer has to learn to honour it.
 */
export interface FieldFlags {
  /** Rejected on create when absent. Projects to `NOT NULL`. */
  required?: boolean;
  /**
   * Value written when the field is absent on create. Projects to a SQL
   * `DEFAULT`. A field with a default is `NOT NULL` in the projection even
   * without `required`, because the column can never hold NULL.
   */
  default?: string | number | boolean;
  /**
   * How the host fills the field when it is absent AND no `default` applies.
   * Distinct from `default` because the value is computed per write, not baked
   * into the DDL. Also the degradation path for an unambiguous payload-upgrade
   * gap (tier B).
   *
   * Two spellings:
   *   - `'now'` — an ISO timestamp, for `createdAt`/`updatedAt`.
   *   - a `SlugPattern` — DERIVED FROM OTHER FIELDS of the same payload, using
   *     the grammar `slugPattern` already uses (`./slug-pattern`). 0.2.22 adds
   *     this so a type can say where its reserved `title` comes from when the
   *     author supplies none: `ac` truncates its `text`, `endpoint` concatenates
   *     `method` and `path`, `database-table` copies its SQL `name`.
   *
   * Derivation is ONCE, at create — exactly like the slug. Editing `path` later
   * does not move the title, for the same reason it does not move the slug: a
   * value that silently follows another value is a value nobody can rely on.
   */
  computedDefault?: 'now' | SlugPattern;
  /**
   * The ONLY fields an update may set to `null` (tri-state: omitted = no change,
   * `null` = clear, value = replace). Update input schemas derive the nullable
   * union from this flag and nothing else.
   */
  clearable?: boolean;
  /**
   * Written by the host, never by the type: `createdAt` / `updatedAt`. Rebuild
   * copies these from the file verbatim rather than re-stamping them, which is
   * what keeps `file → index → file` a fixpoint.
   */
  systemManaged?: boolean;
  /**
   * An input that feeds the slug but never reaches the entity file (diagram's
   * `caption`). Present in the create schema, absent from the projection and
   * from the snapshot.
   */
  transientInput?: boolean;
  /**
   * A column that exists only in the index and is NOT reproducible from files
   * (the local `id` rowid). Excluded from snapshot and from the rebuild
   * comparison — the one permitted exception to the projection invariant, and
   * one no identity or ordering may rest on.
   */
  localSurrogate?: boolean;
  /**
   * Soft foreign key to another entity type. Recognised by validation AND by
   * rename propagation, with no per-type code on either side — this flag is what
   * replaces `backend.onEntityRenamed`.
   *
   * `'$type'` marks a POLYMORPHIC ref whose target type is carried by a sibling
   * field named `type` (ac's `verifies[]`). Rename propagation rewrites such a
   * ref only when the sibling matches the renamed type.
   */
  ref?: string;
  /** Missing-target policy. Only `'warn'` today — a broken ref never blocks a write. */
  onMissing?: 'warn';
  /** Target-deleted policy. Only `'leave-dangling'` today. */
  onDelete?: 'leave-dangling';
  /**
   * A field whose value is CONTENT, not a value to compare: a document body, a
   * blob of markdown, anything measured in kilobytes rather than characters.
   *
   * The host treats it as content everywhere at once, which is the point of
   * making it a flag rather than a per-type convention:
   *   - it is issued by NO generic read, on NO surface — not in a generated
   *     view, not under an explicit `select` naming it. What comes back instead
   *     is `has<Field>: boolean`, `<field>Bytes: number` and the NAME of the
   *     operation that will hand over the content;
   *   - it stays in the SNAPSHOT — it is reproducible from the entity file, so
   *     the projection invariant binds it exactly like any other field;
   *   - the default diff reports `<field>_changed: { fromBytes, toBytes }`
   *     instead of two payloads no reader can compare side by side;
   *   - it is out of `search_entities`' scanning scope.
   *
   * 0.2.22 sharpened the first bullet. It used to read "excluded from the five
   * generated views", which left two holes: a type computing its own views could
   * serve the field anyway (so such types were banned from the flag outright),
   * and the REST layer feeding the UI was assumed to be exempt. Both are gone.
   * Exclusion is now a property of the READ, not of the view, so the ban is
   * lifted and there is no UI exception: a React component fetches a body
   * through the same operation an agent does.
   *
   * The remaining rule: the content must be REACHABLE. The host generates
   * `get_field_content(type, slug, field)` for every flagged field, on all three
   * channels, so this holds by default. A type wanting something richer than
   * "return the whole value" — a windowed read, say — names its own operation in
   * `contentOperation`, and registration rejects a name that does not resolve.
   * A field excluded from every read with no operation behind it would be
   * write-only data, which is not a thing this system should be able to declare.
   */
  contentBearing?: boolean;
  /**
   * Overrides the host-generated `get_field_content` for THIS field.
   *
   * Only meaningful alongside `contentBearing`. The name must resolve in the
   * operation catalog at registration — see `data-schema-validation` — because
   * an unreachable operation is exactly the write-only-data case the flag's
   * reachability rule exists to prevent.
   */
  contentOperation?: string;
  /**
   * Projection column name. Defaults to `snakeCase(fieldName)`; declared only
   * where a type's payload name and its historical column name diverge.
   */
  column?: string;
  /**
   * Prose for a human or an agent reading this field. The one member of this
   * interface the host does not ACT on — it is carried, never interpreted.
   *
   * It is here because item 27 makes `data.schema` the sole source of the CRUD
   * input schemas, and the six hand-written `crud-schemas.ts` files it replaces
   * carried a `.describe()` on most of their fields — text `describe_entity_type`
   * publishes straight to the agent. Generating from a declaration with nowhere
   * to put that text would have deleted every one of those sentences silently,
   * which is a worse contract than the drift the generation exists to close.
   * A `missing` patch is filed against the brief asking for the slot.
   */
  description?: string;
}

/** A leaf holding a single scalar. */
export interface ScalarNode extends FieldFlags {
  type: 'string' | 'number' | 'boolean';
  /**
   * NUMBER ONLY — the value must be an integer.
   *
   * Present because a declaration that cannot say "this is a count" forces every
   * type carrying one to either accept `-1` and `2.5` or hand-write the schema
   * it was supposed to have derived. A count reaching the projection is not a
   * cosmetic problem: an extent of `-1` makes every keyed write refuse (no
   * coordinate satisfies `at <= extent`) and every axis insert refuse (the
   * highest legal position is `extent + 1 = 0`, below the 1-based floor), so the
   * row is created and is then unusable by construction.
   *
   * Ignored on a non-number leaf rather than rejected — see
   * `data-schema-validation`, which reports it, so the silent case cannot arise.
   */
  integer?: boolean;
  /** NUMBER ONLY — inclusive lower bound. */
  min?: number;
  /** NUMBER ONLY — inclusive upper bound. */
  max?: number;
  /**
   * STRING ONLY — the value may be at most `n` characters. Enforced ON WRITE
   * ONLY (`VALIDATION_ERROR`, per item); a read never checks it and never
   * shortens a value it was given.
   *
   * 0.2.22 introduces it as a VALUE CONSTRAINT — a second declaration axis
   * beside the closed flag vocabulary above, published by `describe_*` under
   * `constraints` so a caller can see the rule before it trips over it.
   *
   * NOT part of `data.integrity`. That vocabulary drives projection and DDL and
   * excludes CHECK-shaped rules on purpose; a length bound is a domain truth
   * about the value, not a shape the table has to enforce.
   *
   * Three truncations exist in this system and they do not overlap:
   *   - `maxLength` — domain truth, at write time, refuses;
   *   - `truncate(n)` inside `slugPattern`/`computedDefault` — derivation, at
   *     write time, shortens;
   *   - the read budget's `truncated` flag — protects the CALLER's context
   *     window, at read time, and says so in the envelope.
   *
   * DECLARING OR NARROWING one over existing longer values is a breaking change
   * and must go through a `payloadUpgrades` step that either truncates
   * explicitly or refuses and names the offending slugs. Never silently, and
   * never as a validation error on some later unrelated write.
   */
  maxLength?: number;
  /**
   * STRING ONLY — the value must pass a NAMED VALIDATOR from the host's registry
   * (`./named-validators`). The third and last member of the value-constraint
   * dictionary, beside `type: 'enum'` + `values` and `maxLength`.
   *
   * The name resolves to HOST CODE, not to an expression in the declaration: the
   * type says `kind: 'sql-identifier'`, and what that means is the host's to
   * know. That boundary is the point of the axis. It replaces the pair this
   * release removed — a raw `pattern` string and a `notReserved: 'sql'` flag —
   * and replaces them without reopening them: `minLength` and `pattern` are not
   * in the dictionary and are not coming. A field with a fixed format gets a
   * named validator or it gets nothing.
   *
   * Enforced on the INPUT schema, on both external doors, and never on a read:
   * a violation is a `VALIDATION_ERROR` per item at write time, loud, with no
   * silent truncation and no coercion.
   *
   * NOT part of `data.integrity` and never reaching DDL — exactly like
   * `maxLength`, and for the same reason: it is a domain truth about the value,
   * not a shape the table enforces. No `CHECK` is generated.
   *
   * DECLARING ONE over values that do not already pass is a breaking change and
   * must go through a `payloadUpgrades` step. Unlike `maxLength`, truncation is
   * not an option here: the step either rewrites the value or refuses.
   *
   * Rejected on a non-string leaf, and rejected at registration when the name is
   * not in the registry, so a typo cannot surface later as a value that was
   * never actually screened.
   */
  kind?: ValidatorKind;
  /**
   * STRING ONLY — CANONICALIZE the value on write instead of refusing it.
   *
   * This is the one declaration on a scalar leaf that COERCES. `maxLength` and
   * `kind` are the opposite axis: they screen a value and refuse it loudly, with
   * no silent rewriting. `normalize` exists for the case where several spellings
   * genuinely mean one thing — `TypeScript`, `ts` and `typescript` are one
   * language, not three — and where refusing the variant spellings would be
   * hostile rather than protective.
   *
   * ORDER IS FIXED AND PART OF THE CONTRACT: case-fold first (`case: 'lower'`),
   * then look the FOLDED value up in `aliases`. A miss stores the folded value
   * unchanged. It NEVER refuses — a value outside the table is a legal value the
   * host simply has no synonym for.
   *
   * Applied by the generic write path (`generic-crud`), so it covers both
   * external doors — the generated REST router and the generic MCP
   * `create_entities` / `update_entities` — without the type needing a `backend`
   * slot to reach them. It is deliberately NOT applied on the restore/reindex
   * path: values on disk were normalized when they were written, so replay is
   * already canonical, and normalizing there would break the `file → index →
   * file` convergence this schema's header rests on (a hand-edited file saying
   * `ts` would index as `typescript` while the file still said `ts`).
   *
   * NOT part of `data.integrity` and never reaching DDL — exactly like
   * `maxLength` and `kind`, and for the same reason: it is a domain truth about
   * the value, not a shape the table enforces. No `CHECK`, no column, no change
   * to the DDL default.
   *
   * Published by `describe_*` under `constraints`, because an agent that writes
   * `ts` and reads back `typescript` otherwise has nothing explaining why.
   *
   * Rejected on a non-string leaf; see `data-schema-validation` for the rest of
   * the registration-time gates (an empty declaration, an alias key that is not
   * already folded, and an alias TARGET that would violate the field's own
   * `maxLength` or `kind` — that last one matters because zod runs in the router
   * BEFORE normalization, so a normalized value would otherwise slip past the
   * input schema entirely).
   */
  normalize?: FieldNormalization;
}

/**
 * How a scalar string leaf is canonicalized on write. See `ScalarNode.normalize`
 * for the ordering contract and for why this is the only coercing declaration.
 *
 * Both halves are optional individually but the object must declare at least one
 * of them — an empty `normalize` declares nothing and is refused at registration.
 */
export interface FieldNormalization {
  /** Fold the value to lower case before the alias lookup. */
  case?: 'lower';
  /**
   * Synonym table, consulted AFTER folding. Keys must already be folded when
   * `case: 'lower'` is set, and no target may itself be a key — together those
   * two rules make normalization idempotent by construction.
   */
  aliases?: Readonly<Record<string, string>>;
}

/**
 * Apply a leaf's `normalize` declaration to one value.
 *
 * Total and idempotent: a non-string (or a leaf declaring no `normalize`) comes
 * back untouched, and a value that is already canonical maps to itself.
 */
export function normalizeFieldValue(node: FieldNode, value: unknown): unknown {
  if (node.type !== 'string') return value;
  const rule = (node as ScalarNode).normalize;
  if (!rule) return value;
  if (typeof value !== 'string') return value;
  const folded = rule.case === 'lower' ? value.toLowerCase() : value;
  // OWN keys only. A plain object literal inherits from `Object.prototype`, so a
  // bare `aliases[folded]` resolves `constructor`, `__proto__`, `toString` and
  // the rest — and case-folding puts every capitalisation of them in reach. The
  // result is then a value no author declared, arriving AFTER the input schema
  // has run: `language: 'Constructor'` stored 35 characters into a field
  // declaring `maxLength: 30`. The registration gates screen the DECLARED
  // targets; this is what keeps the lookup to them.
  const aliases = rule.aliases;
  if (aliases === undefined || !Object.prototype.hasOwnProperty.call(aliases, folded)) return folded;
  return aliases[folded];
}

/**
 * Apply every `normalize` declaration in a schema to a payload's TOP-LEVEL
 * scalar leaves, returning a new object. Keys absent from the payload stay
 * absent — an absent field is filled by the DDL default, not by this.
 */
export function normalizePayload(
  schema: Readonly<Record<string, FieldNode>>,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const [name, node] of Object.entries(schema)) {
    if (!(name in payload)) continue;
    const next = normalizeFieldValue(node, payload[name]);
    if (next === payload[name]) continue;
    out ??= { ...payload };
    out[name] = next;
  }
  return out ?? payload;
}

/** A leaf constrained to a closed set of strings. Projects to `TEXT`, validated on write. */
export interface EnumNode extends FieldFlags {
  type: 'enum';
  values: readonly string[];
}

/** A nested object with named fields. */
export interface ObjectNode extends FieldFlags {
  type: 'object';
  fields: Readonly<Record<string, FieldNode>>;
}

/**
 * One axis of a keyed collection's coordinate pair.
 *
 * WHY THIS SLOT EXISTS. M39 describes a keyed collection's key as "an ordered
 * pair of coordinates" and says `overview` reports "the parent's dimensions" —
 * but it never says which declared field holds a given axis's length, and the
 * spec confirms the pair is an INTERPRETATION of the key tuple rather than a
 * declared slot. Something has to close that: `overview` must answer "how tall
 * is this grid" without reading a single item body, so the answer has to be a
 * field it can read off the parent row.
 *
 * `extent` is that field, and it is deliberately NOT derived from the maximum
 * stored coordinate. Sparse discipline says an empty value is not stored and
 * that `overview` cannot distinguish "key deleted" from "key never written";
 * a max-coordinate rule would therefore shrink the grid the moment the last
 * cell of the last row was cleared. The spec states the same conclusion from
 * the other direction — "dimensions may exceed the elements' maximum
 * coordinates (trailing empty rows are metadata)".
 */
export interface AxisSpec {
  /** The `keyFields` entry carrying this axis's coordinate. Must be a `number` leaf. */
  key: string;
  /** The PARENT field holding this axis's length. Must be a `number` leaf on the entity itself. */
  extent: string;
}

/**
 * An ordered list of items.
 *
 * `collection` is MANDATORY and BINARY. There is deliberately no default: the
 * two variants differ in where the rows live, how restore reconciles them and
 * how they are read, so a type that has not decided has not finished declaring
 * its schema. A collection node without it is rejected at registration.
 *
 *   - `'value'` — the collection IS the field. Small, read whole, replaced whole
 *     on restore. Projects to embedded JSON on the parent row, plus a derived
 *     table when the item is an object (see `./projection` in the server).
 *   - `'keyed'` — addressed by key, read in windows, reconciled key-by-key.
 *     Projects to a separate table; never embedded on the parent.
 */
/**
 * How the collection is addressed, and — for a value collection — what makes one
 * of its ELEMENTS the same element across two captures.
 *
 * The bare strings came first and stay legal: widening this to an object was
 * additive, not a migration. The object form exists because the delta engine
 * (`server/serialization/schema-diff.ts`) has to answer a question the bare
 * enum cannot express — "is this the same item, edited, or a different item?" —
 * and the only honest answer comes from the type, once, in the same place it
 * declares everything else about its fields.
 *
 * `identity` is a list of ELEMENT field names, not an expression. It deliberately
 * does NOT borrow `slugPattern` / `computedDefault`: those derive a value at
 * WRITE time, this compares values at READ-HISTORY time, and one grammar serving
 * both would make a change to either a change to both.
 *
 * `rekeyOn` is a proper, non-empty prefix of `identity`. It feeds the delta's
 * SECOND matching pass so that editing a key field comes back as a move
 * (`item_rekeyed`) rather than as a remove/add pair.
 *
 * NO `identity` IS A DECISION, not an omission: such a collection matches BY
 * INDEX, which is to say reordering its elements IS a change. That is what
 * `database-table.columns` wants — column order is part of the table.
 */
export type CollectionFlag =
  | 'value'
  | 'keyed'
  | { kind: 'value'; identity?: readonly string[]; rekeyOn?: readonly string[] }
  | { kind: 'keyed' };

export interface CollectionNode extends FieldFlags {
  type: 'collection';
  collection: CollectionFlag;
  item: FieldNode;
  /**
   * A LIST read takes this collection's size instead of its contents.
   *
   * Only meaningful on a `'value'` collection — a `'keyed'` one already projects
   * as `{ count }` on every read, because it is never materialised at all.
   *
   * The flag says something about the collection, not about any one page: that
   * its contents are worth more than a list row can justify carrying. `ui-view`
   * rows rendered a parameter COUNT while receiving every `params[]` entry, and
   * `design-system` rows rendered a group count while receiving every token with
   * its resolved value per mode. Both paid the entity's expensive half to print
   * one integer, on every row, forever.
   *
   * What arrives in its place is `<field>Count` (see `collectionCountKey`),
   * counted rather than read. A single-entity GET is untouched and still carries
   * the array — narrowing is what a LIST asked for, not a new shape for the type.
   */
  listOverview?: boolean;
  /**
   * The tuple addressing one item within its parent.
   *
   * Mandatory for `'keyed'` — the key IS the address there. On a `'value'`
   * collection it is OPTIONAL and is the discriminator deciding the physical
   * shape, which is the one thing neither the brief nor the current
   * specification settles:
   *
   *   - declared → the collection projects to a JUNCTION TABLE, one row per
   *     item, with the tuple as `UNIQUE(...)`. `endpoint.linked_dtos` is this,
   *     and it is why `endpoint_dto` exists.
   *   - absent → embedded JSON on the parent row. `ac.verifies` is this.
   *
   * Both are value collections of objects carrying a `ref`, and both are
   * described by the same sentence in M13 ("value → embedded JSON") while having
   * opposite projections in the actual schema. Rather than infer the difference
   * from the item's shape — a rule that cannot separate these two, since they
   * have the SAME shape — the author declares it. A clarification patch is filed
   * against the brief asking for this to become the written convention.
   */
  keyFields?: readonly string[];
  /**
   * The two coordinate axes of a `'keyed'` collection, in order.
   *
   * Mandatory for `'keyed'` and meaningless on `'value'`. Exactly two: M39's
   * read surface is a RECTANGLE over two axes, and "full row" / "full column"
   * are degenerate rectangles rather than separate primitives — a one-axis or
   * three-axis collection has no defined window and is rejected at registration
   * rather than given a silently different read shape.
   */
  axes?: readonly [AxisSpec, AxisSpec];
  /**
   * Projection table name for a collection that gets one. Defaults to
   * `${parentTable}_${snakeCase(field)}`; declared where history says otherwise
   * (`endpoint.linked_dtos` → `endpoint_dto`, not `endpoint_linked_dtos`).
   */
  projectionTable?: string;
  /**
   * Item order carries no meaning, so the SNAPSHOT sorts it — which is what
   * makes two captures of an unchanged entity byte-identical when the rows
   * underneath came back in a different order.
   *
   * OPT-IN, and the default matters more than the flag. The brief names three
   * arrays that must sort stably (`tags[]`, `linked_dtos[]`, `verifies[]`), but
   * a blanket "sort every collection" would also reorder
   * `design-system.groups[].tokens[]` — a `sm`/`md`/`xl` scale whose order IS
   * the documentation — and `dto.fields[]`, where declaration order is the DTO.
   * Sorting those is not a normalization, it is a silent edit to authored
   * content, and it would be invisible in review because the file still parses.
   *
   * See {@link sortKeyFieldsOf} for what "sorted" means.
   */
  unordered?: boolean;
}

/**
 * A map node carrying BOTH a key schema and a value schema.
 *
 * Called out separately from `object` because the search-path deriver used to
 * skip map branches silently (no declared `properties` to recurse into); with
 * the key schema declared there is nothing left to guess.
 */
export interface RecordNode extends FieldFlags {
  type: 'record';
  key: FieldNode;
  value: FieldNode;
}

/**
 * An opaque JSON value: the host stores it, round-trips it and never looks
 * inside. No key schema, no value schema, no searchable leaves.
 *
 * The escape hatch the closed vocabulary was missing, and two SHIPPED
 * declarations already needed it before item 27 made the omission visible:
 *
 *   - `design-system` token values are `"#2563eb"` OR `{fontSize, lineHeight}`.
 *     Declared as `record<string,string>`, which drops the literal arm — the
 *     common one.
 *   - `dto.examples[].value` is a payload exemplar, "as-is", soft-validated
 *     against `fields[]`. Declared as `record<string,string>`, which admits
 *     neither a number nor a nested object.
 *
 * Both were harmless while the declaration only DESCRIBED (tier B's read
 * schemas) and became rejections the moment it started VALIDATING (item 27's
 * CRUD input schemas): a design system could no longer be created with a colour
 * in it. A union node would say the same thing more precisely, but every other
 * consumer — the DDL, the write path, rename propagation — treats both arms
 * identically (embedded JSON text), so the distinction would be one no host
 * layer could act on. Filed against the brief as a `missing` patch.
 */
export interface JsonNode extends FieldFlags {
  type: 'json';
}

export type FieldNode = ScalarNode | EnumNode | ObjectNode | CollectionNode | RecordNode | JsonNode;

/**
 * A query shape the type expects to run — NOT an index.
 *
 * It describes the QUESTION (which attributes get filtered together, what the
 * range axis is, what the sort key is). Whether that becomes a physical index,
 * and of what shape, is the host's decision and may change without any type
 * being re-authored.
 */
export interface AccessHint {
  /** Fields filtered together in one query. */
  filter?: readonly string[];
  /** Field the query sorts by. */
  sort?: string;
  /** Collection this hint applies to; omitted = the type's own row. */
  collection?: string;
}

/**
 * The CLOSED vocabulary of integrity constraints.
 *
 * Anything outside it is a loud registration error, not a silently ignored slot.
 * The vocabulary is closed because each entry is something the host must be able
 * to both emit as DDL and reason about — an open slot would be raw SQL by
 * another name, and that surface was closed in 0.2.4.
 */
export type IntegrityConstraint =
  | { kind: 'check'; expr: string }
  | { kind: 'unique'; fields: readonly string[] }
  | { kind: 'fk'; field: string; references: { type: string } };

/** The `data` slot on a manifest. */
export interface DataDeclaration {
  schema: Readonly<Record<string, FieldNode>>;
  access?: readonly AccessHint[];
  integrity?: readonly IntegrityConstraint[];
}

/**
 * A declarative filter over the type's OWN fields — the type's DEFAULT view of
 * itself.
 *
 * Replaces `SystemPromptContribution.countStat.sqlQuery`, the last place a
 * module handed the host raw SQL to execute. Equality and set membership only:
 * cross-entity predicates are out of scope by design, and a raw-SQL slot is
 * excluded permanently because it would break M13's read-exclusivity invariant.
 *
 * 2.0.0 tier K — was `CountPredicate`, and count was its only consumer. It now
 * has two: `RawEntityReader.count()` and the implicit filter every list read
 * starts from (`slugsMatching`), which a caller overrides per field by naming
 * that field in `filters`. The rename is the point — `ac` declares
 * `{ field: 'status', in: ['active'] }` because a deprecated AC is not part of
 * the working set, and that was true of the LIST long before it was true of the
 * badge. Keeping the count-only name is what let the two disagree: the sidebar
 * said 12 while the list showed 17.
 */
export interface DefaultPredicate {
  field: string;
  eq?: string | number | boolean;
  in?: readonly (string | number | boolean)[];
}

/** Maximum nesting the projection generator will walk. Exceeding it is a registration error. */
export const MAX_PROJECTION_DEPTH = 4;

/** Payload-name → column-name. `designSystemSlug` → `design_system_slug`. */
export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

/** The projection column a field lands in. */
export function columnOf(name: string, node: FieldNode): string {
  return node.column ?? snakeCase(name);
}

/**
 * The two keys a `contentBearing` field is replaced by in every generated view:
 * `body` → `{ has: 'hasBody', bytes: 'bodyBytes' }`.
 *
 * Derived in one place because three layers have to agree on the spelling — the
 * payload builder, the JSON Schema deriver and the diff — and a field name
 * spelled by hand in three files is a field name spelled two ways in two of them.
 */
export function contentBearingKeys(name: string): { has: string; bytes: string } {
  return { has: `has${name.charAt(0).toUpperCase()}${name.slice(1)}`, bytes: `${name}Bytes` };
}

/**
 * The key a VALUE collection is replaced by when the caller's `select` leaves it
 * out: `params` → `paramsCount`.
 *
 * Same bargain as `contentBearingKeys`, one axis over. A content-bearing field is
 * withheld because it is always too big to inline; a value collection is withheld
 * because THIS caller said so — but in both cases the record can still answer the
 * one question that survives not carrying the thing, and answer it without
 * reading it (`countCollection` is a `COUNT(*)`, not a `readCollection().length`).
 *
 * A KEYED collection has no use for this: it already projects as `{ count }`
 * whether or not it was selected, because it is never materialised at all.
 */
export function collectionCountKey(name: string): string {
  return `${name}Count`;
}

/**
 * The reserved field EVERY registered type must declare, spelled once.
 *
 * 0.2.22 — one source for the label, the slug and the identity end of the search
 * scope. Before it, each type named itself differently (`ac.text`, `dto.name`,
 * `endpoint.method + path`, `diagram` not at all), and the consequence was not
 * cosmetic: the read contract promised `inline_mention.label` without saying
 * which field fed it, so types overrode whole view sets purely to show a name
 * instead of a slug, and `resolve_identity` had to guess through a
 * `name ?? label ?? title` chain.
 *
 * `maxLength: 200` is declared by the HOST, not by the type, which is what makes
 * "a title never needs shortening at read time" a fact rather than a hope.
 *
 * Exported as data so the validator, the scaffold and the tests all compare
 * against the same object instead of three transcriptions of it.
 */
export const RESERVED_TITLE_FIELD = 'title';
export const TITLE_MAX_LENGTH = 200;
export const RESERVED_TITLE_DECLARATION: ScalarNode = {
  type: 'string',
  required: true,
  maxLength: TITLE_MAX_LENGTH,
};

/**
 * The identity fields present on EVERY record, whatever `select` asked for.
 *
 * They come from the envelope rather than from `data` — `slug` is the row's
 * identity, `tags` are a cross-cutting relation, and `title` is reserved — so a
 * projection cannot remove them and a caller never has to ask for them.
 *
 * `href` joins them as the one identity field the host GENERATES, from the
 * type's `pathPrefix` and the slug (`/endpoints/get-users`). It is the reason a
 * chip can still be a link now that no per-type view contributes one: an
 * informational path to the entity's page in the web UI, not a claim that a
 * server is answering on it.
 */
export const IDENTITY_FIELDS = ['slug', RESERVED_TITLE_FIELD, 'tags', 'href'] as const;

/** UTF-8 size of a content-bearing value; absent/null counts as 0. */
export function contentBytes(value: unknown): number {
  if (value == null) return 0;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  // `Buffer` is unavailable in the client bundle, and this module is shared.
  return new TextEncoder().encode(text ?? '').length;
}

/** The host-generated operation that issues a `contentBearing` field's content. */
export const DEFAULT_CONTENT_OPERATION = 'get_field_content';

/** Which operation hands over THIS field's content — the type's override, or the host's. */
export function contentOperationOf(node: FieldNode): string {
  return node.contentOperation ?? DEFAULT_CONTENT_OPERATION;
}

/**
 * The flat list of names legal in `get_entities`' `select`.
 *
 * TOP-LEVEL ONLY, and that is a semantic limit rather than a transport one: a
 * `collection: 'value'` is declared opaque and read whole, so descending into
 * `columns[].name` would break the property that makes it opaque. A type wanting
 * partial reads declares the collection `'keyed'` and gets a windowed operation.
 *
 * `contentBearing` fields ARE included. Naming one is not an error — it answers
 * with the field's descriptor and the operation that issues it, which is a more
 * useful reply than a refusal.
 *
 * A value collection in its OWN table publishes a second name, `<field>Count`,
 * alongside the field itself: the size instead of the contents, counted rather
 * than read. Two names for one field, because there are genuinely two questions
 * and the expensive one is not always the one being asked — a list row printing
 * `3p` wants the number, and until 0.2.55 the only way to get it was to receive
 * every parameter. It is a SEPARATE name rather than a mode of the first so that
 * `select: []` keeps costing nothing: a caller gets a count only by asking.
 *
 * Embedded collections get the count name too, and it is answered differently:
 * they ride on the entity's own row, so the array is already in hand and the
 * count is `length` rather than a query. There is no read to save there — what
 * the caller saves is the BYTES, which for `design-system.groups` is every token
 * with its resolved value per mode, on every row of the list.
 *
 * Transient inputs are excluded: they never reach a stored entity, so there is
 * nothing to project.
 */
export function selectableFieldsOf(schema: Readonly<Record<string, FieldNode>>): string[] {
  const out: string[] = [];
  for (const [name, node] of Object.entries(schema)) {
    if (node.transientInput || node.localSurrogate) continue;
    out.push(name);
    if (node.type === 'collection' && !isKeyed(node)) out.push(collectionCountKey(name));
  }
  return out;
}

/** A value constraint as `describe_*` publishes it. */
export type FieldConstraint =
  | { field: string; type: 'enum'; values: readonly string[] }
  | { field: string; type: 'maxLength'; maxLength: number }
  | { field: string; type: 'kind'; kind: ValidatorKind; describe: string }
  | {
      field: string;
      type: 'normalize';
      case?: 'lower';
      aliases?: Readonly<Record<string, string>>;
    };

/**
 * Every value constraint the schema declares, flattened for `describe_*`.
 *
 * Published so a caller learns the rule BEFORE a write trips over it. Read from
 * the same declaration the write path enforces, so the advertisement and the
 * enforcement cannot drift.
 */
export function constraintsOf(schema: Readonly<Record<string, FieldNode>>): FieldConstraint[] {
  const out: FieldConstraint[] = [];
  for (const [field, node] of Object.entries(schema)) {
    if (node.type === 'enum') out.push({ field, type: 'enum', values: node.values });
    if (node.type === 'string' && node.maxLength !== undefined) {
      out.push({ field, type: 'maxLength', maxLength: node.maxLength });
    }
    // Published with its prose, not just its name: a caller that has never heard
    // of `sql-identifier` still learns the rule before a write teaches it.
    if (node.type === 'string' && node.kind !== undefined) {
      out.push({ field, type: 'kind', kind: node.kind, describe: describeValidator(node.kind) });
    }
    // The one COERCING constraint, and the one most worth publishing: without
    // it an agent writes `ts`, reads back `typescript`, and has nothing telling
    // it that was the rule rather than a bug.
    if (node.type === 'string' && node.normalize !== undefined) {
      out.push({
        field,
        type: 'normalize',
        ...(node.normalize.case ? { case: node.normalize.case } : {}),
        ...(node.normalize.aliases ? { aliases: node.normalize.aliases } : {}),
      });
    }
  }
  return out;
}

/** The `contentBearing` fields, each with the operation that issues its content. */
export function contentFieldsOf(
  schema: Readonly<Record<string, FieldNode>>,
): Array<{ field: string; operation: string }> {
  return Object.entries(schema)
    .filter(([, node]) => node.contentBearing)
    .map(([field, node]) => ({ field, operation: contentOperationOf(node) }));
}

/**
 * True when the field projects to its own table rather than to a column on the
 * parent row: every `keyed` collection, and a `value` collection that declared
 * `keyFields` (see {@link CollectionNode.keyFields}).
 */
export function hasProjectionTable(node: FieldNode): boolean {
  if (node.type !== 'collection') return false;
  return collectionKindOf(node) === 'keyed' || !!node.keyFields?.length;
}

/** True when the field lives on the parent row. The complement of {@link hasProjectionTable}. */
export function isEmbedded(node: FieldNode): boolean {
  return !hasProjectionTable(node) && !node.transientInput && !node.localSurrogate;
}

/**
 * True for a collection addressed by key — read in windows, reconciled per key.
 *
 * A predicate rather than an inline `node.collection === 'keyed'` because the
 * two collection kinds diverge in FIVE places (write reconciliation, snapshot
 * compaction, the read surface, restore semantics, and whether an axis
 * operation applies), and every one of them has to ask the same question the
 * same way. The tier-C write door exists precisely because one of them once
 * did not.
 */
export function isKeyed(node: FieldNode): node is CollectionNode {
  return node.type === 'collection' && collectionKindOf(node) === 'keyed';
}

/**
 * The collection's kind, whichever of the two spellings the author used.
 *
 * Every consumer asks through this rather than comparing `node.collection`
 * directly — the flag has two legal shapes and a bare `=== 'keyed'` silently
 * answers `false` for the object spelling, which is the kind of bug that shows
 * up as a table that quietly stopped being generated.
 */
export function collectionKindOf(node: CollectionNode): 'value' | 'keyed' {
  return typeof node.collection === 'string' ? node.collection : node.collection.kind;
}

/**
 * The element field names the delta engine matches on, or `[]` when the type
 * declared none — which means "match by index", not "match by deep equality".
 */
export function identityOf(node: CollectionNode): readonly string[] {
  if (typeof node.collection === 'string' || node.collection.kind !== 'value') return [];
  return node.collection.identity ?? [];
}

/** The prefix of {@link identityOf} used by the delta's second, rekey pass. */
export function rekeyOnOf(node: CollectionNode): readonly string[] {
  if (typeof node.collection === 'string' || node.collection.kind !== 'value') return [];
  return node.collection.rekeyOn ?? [];
}

/**
 * The two axes of a keyed collection.
 *
 * Empty for anything else, so a caller can iterate without first branching on
 * the collection kind. Registration validation guarantees a keyed collection
 * has exactly two, so a keyed node reaching a reader with none is a wiring bug
 * rather than a data condition.
 */
export function axesOf(node: FieldNode): readonly AxisSpec[] {
  return isKeyed(node) ? (node.axes ?? []) : [];
}

/**
 * The item fields that are NOT part of the address.
 *
 * What "empty" is judged on under sparse discipline: a keyed item whose payload
 * fields are all empty is a DELETION of that key, and the coordinates cannot
 * take part in that decision because they are never empty — they are what the
 * key is.
 */
export function payloadFieldsOf(node: CollectionNode): readonly string[] {
  if (node.item.type !== 'object') return ['value'];
  const keys = new Set(node.keyFields ?? []);
  return Object.keys(node.item.fields).filter((name) => !keys.has(name));
}

/**
 * The fields an `unordered` collection sorts its items by, most significant
 * first.
 *
 * `keyFields` when declared — the tuple that already addresses one item is by
 * construction the tuple that orders them. Otherwise the item object's fields in
 * DECLARATION ORDER, which is the part worth stating: sorting by the item's
 * fields in *alphabetical* order would compare `ac.verifies` on `slug` before
 * `type` and reorder every AC file in the corpus on first rebuild. Declaration
 * order reproduces the hand-written `` `${type}/${slug}` `` key exactly, and it
 * gives an author a way to say what the order is without a second slot.
 *
 * A collection of scalars sorts by the value itself, so it needs no key.
 */
export function sortKeyFieldsOf(node: CollectionNode): readonly string[] {
  if (node.keyFields?.length) return node.keyFields;
  if (node.item.type === 'object') return Object.keys(node.item.fields);
  return [];
}

/** Walk every node in a schema, depth-first, reporting the dotted payload path. */
export function walkSchema(
  schema: Readonly<Record<string, FieldNode>>,
  visit: (path: string, node: FieldNode, depth: number) => void,
): void {
  const walk = (fields: Readonly<Record<string, FieldNode>>, prefix: string, depth: number): void => {
    for (const [name, node] of Object.entries(fields)) {
      const path = prefix ? `${prefix}.${name}` : name;
      visit(path, node, depth);
      if (node.type === 'object') walk(node.fields, path, depth + 1);
      else if (node.type === 'collection') {
        // The item is the collection's own level, not a level below it: a
        // collection of objects nests exactly as deep as an object does. Counting
        // it twice would make `design-system.groups[].tokens[].value` read as
        // depth 5 when it is 3 wrappers deep, and reject a schema that projects
        // fine.
        const itemPath = `${path}[]`;
        visit(itemPath, node.item, depth);
        if (node.item.type === 'object') walk(node.item.fields, itemPath, depth + 1);
      } else if (node.type === 'record') {
        visit(`${path}.$key`, node.key, depth + 1);
        visit(`${path}.$value`, node.value, depth + 1);
        if (node.value.type === 'object') walk(node.value.fields, `${path}.$value`, depth + 1);
      }
    }
  };
  walk(schema, '', 0);
}

/**
 * The CLOSED dictionary of delta operations (0.2.31).
 *
 * Lives in `shared/` because both sides read it: the server GENERATES it from
 * this same file's schema nodes, and the client renders it. It replaced five
 * mutually incompatible per-type `changes` bags, and the point of closing it is
 * that a consumer can `switch` exhaustively — a formatter with no per-entity-type
 * branch is only possible if the dictionary is the same for every type.
 *
 * `path` is always a path in the LOGICAL SCHEMA (`title`, `params`,
 * `groups[].tokens`) — never a name a type invented for its own diff. The two
 * tag operations are the only ones WITHOUT a `path`, and that is not an
 * inconsistency: tags are not a schema field, they ride the entity envelope.
 */
export type IdentityKey = Record<string, string | number | boolean>;

export type DiffOp =
  /** A comparable value changed. The one encoding of a scalar change, for every type. */
  | { op: 'field_changed'; path: string; from: unknown; to: unknown }
  /**
   * A value that cannot be shown side by side changed — a `contentBearing`
   * field, or a free-JSON field with no schema to compare against. NEVER a
   * boolean "it changed", never the full value: the two sizes are what a reader
   * can actually act on.
   */
  | { op: 'field_changed_opaque'; path: string; fromBytes: number; toBytes: number }
  | { op: 'item_added'; path: string; identity: IdentityKey; item: unknown }
  | { op: 'item_removed'; path: string; identity: IdentityKey; item: unknown }
  /** Recursive: the nested list uses this same dictionary. Never a COUNT. */
  | { op: 'item_modified'; path: string; identity: IdentityKey; changes: DiffOp[] }
  /** A key field of a matched item moved — pass 2 of the collection match. */
  | { op: 'item_rekeyed'; path: string; identity: IdentityKey; field: string; from: unknown; to: unknown }
  | { op: 'tag_added'; tag: string }
  | { op: 'tag_removed'; tag: string };

/** The envelope. `changes: []` for `noop`, `created` and `deleted` alike. */
export interface EntityDiff {
  op: 'created' | 'updated' | 'deleted' | 'noop';
  changes: DiffOp[];
}

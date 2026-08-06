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
   * Named host routine filling the field when it is absent AND no `default`
   * applies — today only `'now'` (an ISO timestamp). Distinct from `default`
   * because the value is computed per write, not baked into the DDL.
   *
   * Also the degradation path for an unambiguous payload-upgrade gap (tier B).
   */
  computedDefault?: 'now';
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
  kind: 'string' | 'number' | 'boolean';
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
   * STRING ONLY — a regex the value must match.
   *
   * A SOURCE STRING, not a `RegExp`: a declaration is pure data that has to
   * survive being read, serialised and compared, and a live object survives none
   * of that.
   *
   * ANCHOR IT YOURSELF. It is applied with zod's `.regex()`, which SEARCHES —
   * `'[a-z]+'` accepts `'!!! nope ???'`. Every caller so far means `^…$`.
   *
   * Present for the same reason `integer` is: a type whose identifier must be a
   * SQL identifier had no way to say so, and the only other place to put the
   * rule — a per-type validation hook — does not exist on `EntityContribution`.
   *
   * Rejected on a non-string leaf rather than ignored, and rejected at
   * registration when it does not compile, so a typo cannot surface later as a
   * throw from deep inside router construction.
   */
  pattern?: string;
  /**
   * STRING ONLY — the value may not be a reserved SQL word, compared
   * case-insensitively against the same list the host screens its own generated
   * identifiers with (`SQL_RESERVED_WORDS`).
   *
   * Deliberately NOT expressible as a `pattern`. A 123-alternative negative
   * lookahead is unreviewable, is case-sensitive where the rule is not, and
   * collapses a distinct failure — "that word is reserved", which tells the
   * author what to do — into a generic shape mismatch that does not.
   *
   * A flag rather than a list on the declaration, because the list is the
   * HOST's: a type transcribing its own copy drifts from the one the host
   * actually enforces on the first keyword the host adds.
   */
  notReserved?: 'sql';
}

/** A leaf constrained to a closed set of strings. Projects to `TEXT`, validated on write. */
export interface EnumNode extends FieldFlags {
  kind: 'enum';
  values: readonly string[];
}

/** A nested object with named fields. */
export interface ObjectNode extends FieldFlags {
  kind: 'object';
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
export interface CollectionNode extends FieldFlags {
  kind: 'collection';
  collection: 'value' | 'keyed';
  item: FieldNode;
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
  kind: 'record';
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
  kind: 'json';
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
 * True when the field projects to its own table rather than to a column on the
 * parent row: every `keyed` collection, and a `value` collection that declared
 * `keyFields` (see {@link CollectionNode.keyFields}).
 */
export function hasProjectionTable(node: FieldNode): boolean {
  if (node.kind !== 'collection') return false;
  return node.collection === 'keyed' || !!node.keyFields?.length;
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
  return node.kind === 'collection' && node.collection === 'keyed';
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
  if (node.item.kind !== 'object') return ['value'];
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
  if (node.item.kind === 'object') return Object.keys(node.item.fields);
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
      if (node.kind === 'object') walk(node.fields, path, depth + 1);
      else if (node.kind === 'collection') {
        // The item is the collection's own level, not a level below it: a
        // collection of objects nests exactly as deep as an object does. Counting
        // it twice would make `design-system.groups[].tokens[].value` read as
        // depth 5 when it is 3 wrappers deep, and reject a schema that projects
        // fine.
        const itemPath = `${path}[]`;
        visit(itemPath, node.item, depth);
        if (node.item.kind === 'object') walk(node.item.fields, itemPath, depth + 1);
      } else if (node.kind === 'record') {
        visit(`${path}.$key`, node.key, depth + 1);
        visit(`${path}.$value`, node.value, depth + 1);
        if (node.value.kind === 'object') walk(node.value.fields, `${path}.$value`, depth + 1);
      }
    }
  };
  walk(schema, '', 0);
}

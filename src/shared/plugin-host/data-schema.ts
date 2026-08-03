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
}

/** A leaf holding a single scalar. */
export interface ScalarNode extends FieldFlags {
  kind: 'string' | 'number' | 'boolean';
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
   * Projection table name for a collection that gets one. Defaults to
   * `${parentTable}_${snakeCase(field)}`; declared where history says otherwise
   * (`endpoint.linked_dtos` → `endpoint_dto`, not `endpoint_linked_dtos`).
   */
  projectionTable?: string;
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

export type FieldNode = ScalarNode | EnumNode | ObjectNode | CollectionNode | RecordNode;

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
 * A declarative count filter over the type's OWN fields.
 *
 * Replaces `SystemPromptContribution.countStat.sqlQuery`, the last place a
 * module handed the host raw SQL to execute. Equality and set membership only:
 * cross-entity predicates are out of scope by design, and a raw-SQL slot is
 * excluded permanently because it would break M13's read-exclusivity invariant.
 */
export interface CountPredicate {
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

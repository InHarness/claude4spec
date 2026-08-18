/**
 * Host API 2.0.0 — the SQLite projection is GENERATED from the logical schema.
 *
 * What this replaces: six hand-written `migrations.ts` files, a per-plugin
 * migration ledger (`plugin_schema_migrations`), and the rule that a type's DDL
 * is the type's business. The problem with that arrangement was never the SQL —
 * it was that the DDL and the payload were two independent descriptions of one
 * field set, and nothing checked they agreed. A column could be added to the
 * table and never written; a payload field could be added and never indexed;
 * neither showed up as an error, only as a search that quietly missed rows.
 *
 * A generated projection cannot drift from the payload, because there is only
 * one description left.
 *
 * WHY THIS IS NOT A MIGRATION SYSTEM. A schema change regenerates the
 * projection; it does not migrate it. The entity FILES are authoritative, the
 * index is derivable, so the recovery for any change the generator cannot apply
 * in place is "drop the table and rebuild from `entitiesDir`" — the operation
 * `EntityIndexerService.indexAll()` already performs on every boot. That is why
 * this module only ever CREATEs and ADDs COLUMNs: those are the changes worth
 * doing without a rebuild, and every other change is the rebuild's job.
 *
 * ORDER: `applyProjection` runs at `ProjectContext` construction, BEFORE
 * `indexAll()` and before any read or upsert. A type whose table does not exist
 * yet cannot be read from, and the indexer's first act is to clear the tables it
 * is about to fill.
 */

import type { Database } from 'better-sqlite3';
import {
  columnOf,
  hasProjectionTable,
  isEmbedded,
  snakeCase,
  type CollectionNode,
  type DataDeclaration,
  type FieldNode,
} from '../../shared/plugin-host/data-schema.js';
import { typeTablePrefix } from '../../shared/plugin-host/composition.js';

/** A module as this generator reads it — server and test shapes both satisfy it. */
export interface ProjectableModule {
  type: string;
  data?: DataDeclaration;
}

/** SQLite storage class for a logical node. */
function sqlType(node: FieldNode): string {
  switch (node.type) {
    case 'number':
      // No REAL: every numeric field in the six built-in types is a count, a
      // status code or a coordinate. A type needing floats declares `number` and
      // gets INTEGER affinity, which SQLite still stores losslessly as REAL —
      // affinity is a hint, not a constraint.
      return 'INTEGER';
    case 'boolean':
      return 'INTEGER';
    default:
      // string, enum, object, record, and every embedded collection (JSON text).
      return 'TEXT';
  }
}

/** SQL literal for a declared default. */
function defaultClause(node: FieldNode): string | null {
  if (node.computedDefault === 'now') return `DEFAULT (datetime('now'))`;
  if (node.default !== undefined) {
    if (typeof node.default === 'string') return `DEFAULT '${node.default.replace(/'/g, "''")}'`;
    if (typeof node.default === 'boolean') return `DEFAULT ${node.default ? 1 : 0}`;
    return `DEFAULT ${node.default}`;
  }
  // An embedded collection is never NULL — absent means empty, and a reader that
  // has to distinguish `NULL` from `'[]'` is a reader with two empty cases.
  if (node.type === 'collection') return `DEFAULT '[]'`;
  return null;
}

/**
 * Whether the generated column rejects NULL.
 *
 * Exported because the WRITE path must ask the same question with the same
 * answer: `db/projection-write.ts` decides whether an absent-or-null payload
 * field may be bound as SQL NULL, and any divergence here shows up as a raw
 * `NOT NULL constraint failed` on a payload that is valid per its declaration.
 * One predicate, two readers.
 */
export function isNotNull(node: FieldNode): boolean {
  return (
    node.required === true ||
    node.default !== undefined ||
    node.computedDefault !== undefined ||
    node.type === 'collection'
  );
}

function columnDef(name: string, node: FieldNode): string {
  const parts = [columnOf(name, node), sqlType(node)];
  if (isNotNull(node)) parts.push('NOT NULL');
  const def = defaultClause(node);
  if (def) parts.push(def);
  return parts.join(' ');
}

/** The table a type's own rows live in. */
export function mainTableOf(module: ProjectableModule): string {
  return typeTablePrefix(module.type);
}

/** The table a collection with its own projection lands in. */
export function projectionTableOf(module: ProjectableModule, field: string, node: CollectionNode): string {
  return node.projectionTable ?? `${mainTableOf(module)}_${snakeCase(field)}`;
}

/** The column binding a projection row back to its parent entity. */
export function bindingColumnOf(module: ProjectableModule): string {
  return `${mainTableOf(module)}_slug`;
}

function indexName(table: string, columns: readonly string[]): string {
  return `idx_${table}_${columns.join('_')}`;
}

/**
 * DDL for one collection's projection table.
 *
 * Referential integrity is ENFORCED here, unlike on embedded refs, and the
 * asymmetry is deliberate rather than an inconsistency with `onDelete:
 * 'leave-dangling'`. An embedded ref is a string inside a JSON blob: there is no
 * FK to enforce, and a dangling one degrades to a warning. A projection row is a
 * row the HOST created and the host alone maintains — leaving orphans in it
 * would mean the host failing to clean up after itself, and there is no file to
 * rebuild the correct answer from because the parent is gone.
 */
function projectionTableDDL(
  module: ProjectableModule,
  field: string,
  node: CollectionNode,
): string[] {
  const parent = mainTableOf(module);
  const table = projectionTableOf(module, field, node);
  const binding = bindingColumnOf(module);
  const item = node.item;

  const columns: string[] = [
    `${binding} TEXT NOT NULL REFERENCES ${parent}(slug) ON DELETE CASCADE ON UPDATE CASCADE`,
  ];
  const indexed: string[][] = [[binding]];

  const itemFields: Array<[string, FieldNode]> =
    item.type === 'object' ? Object.entries(item.fields) : [['value', item]];

  for (const [itemName, itemNode] of itemFields) {
    const column = columnOf(itemName, itemNode);
    const parts = [column, sqlType(itemNode)];
    if (isNotNull(itemNode)) parts.push('NOT NULL');
    const def = defaultClause(itemNode);
    if (def) parts.push(def);
    if (itemNode.ref && itemNode.ref !== '$type') {
      parts.push(
        `REFERENCES ${typeTablePrefix(itemNode.ref)}(slug) ON DELETE CASCADE ON UPDATE CASCADE`,
      );
      indexed.push([column]);
    }
    columns.push(parts.join(' '));
  }

  if (node.keyFields?.length) {
    const keyColumns = node.keyFields.map((key) =>
      item.type === 'object' && item.fields[key] ? columnOf(key, item.fields[key]) : snakeCase(key),
    );
    columns.push(`UNIQUE(${[binding, ...keyColumns].join(', ')})`);
  }

  const out = [`CREATE TABLE IF NOT EXISTS ${table} (\n  ${columns.join(',\n  ')}\n);`];
  for (const cols of indexed) {
    out.push(`CREATE INDEX IF NOT EXISTS ${indexName(table, cols)} ON ${table}(${cols.join(', ')});`);
  }
  return out;
}

/**
 * Every `CREATE` statement a module's schema implies, in dependency order.
 *
 * Deterministic and idempotent by construction: the output is a pure function of
 * the declaration, so the same schema yields byte-identical DDL on every boot.
 * `applyProjection` relies on that — it re-runs the whole list each time and
 * expects every statement to be a no-op on an already-projected database.
 */
export function generateProjectionDDL(module: ProjectableModule): string[] {
  const schema = module.data?.schema;
  if (!schema) return [];
  const table = mainTableOf(module);

  /**
   * `slug TEXT NOT NULL PRIMARY KEY`, uniformly.
   *
   * Five of the six built-in tables historically wrote `TEXT PRIMARY KEY`
   * without the `NOT NULL`, and in SQLite that is not redundant: a TEXT PRIMARY
   * KEY column accepts NULL, a long-standing compatibility quirk. `diagram`
   * already spelled it out. Generating the stricter form everywhere fixes four
   * tables that could hold a NULL-slugged row, and is a no-op on existing
   * databases, where `CREATE TABLE IF NOT EXISTS` never fires.
   */
  const columns: string[] = ['slug TEXT NOT NULL PRIMARY KEY'];
  for (const [name, node] of Object.entries(schema)) {
    if (!isEmbedded(node)) continue;
    columns.push(columnDef(name, node));
  }

  for (const constraint of module.data?.integrity ?? []) {
    if (constraint.kind === 'check') columns.push(`CHECK (${constraint.expr})`);
    else if (constraint.kind === 'unique') {
      const cols = constraint.fields.map((f) => {
        const node = schema[f];
        return node ? columnOf(f, node) : snakeCase(f);
      });
      columns.push(`UNIQUE(${cols.join(', ')})`);
    } else if (constraint.kind === 'fk' && schema[constraint.field]) {
      const col = columnOf(constraint.field, schema[constraint.field] as FieldNode);
      columns.push(
        `FOREIGN KEY (${col}) REFERENCES ${typeTablePrefix(constraint.references.type)}(slug)`,
      );
    }
  }

  const out = [`CREATE TABLE IF NOT EXISTS ${table} (\n  ${columns.join(',\n  ')}\n);`];

  /**
   * `data.access` is a HINT — it describes the query, not the index. Today the
   * host answers every hint with a plain index over the filtered columns, which
   * reproduces the four indexes the hand-written migrations carried. That
   * mapping is the host's to change without any type being re-authored, which is
   * the whole point of the slot being a hint.
   */
  for (const hint of module.data?.access ?? []) {
    if (hint.collection) continue; // resolved with the collection's own table below
    const columnFor = (field: string): string => {
      const node = schema[field];
      return node ? columnOf(field, node) : snakeCase(field);
    };
    const cols = (hint.filter ?? []).map(columnFor);
    if (hint.sort && !cols.includes(hint.sort)) cols.push(columnFor(hint.sort));
    if (!cols.length) continue;
    out.push(
      `CREATE INDEX IF NOT EXISTS ${indexName(table, cols)} ON ${table}(${cols.join(', ')});`,
    );
  }

  for (const [name, node] of Object.entries(schema)) {
    if (!hasProjectionTable(node)) continue;
    out.push(...projectionTableDDL(module, name, node as CollectionNode));
  }

  return out;
}

/** Columns a table currently has, in declaration order. */
function existingColumns(db: Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function tableExists(db: Database, table: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

/**
 * `ALTER TABLE ADD COLUMN` accepts only a CONSTANT default.
 *
 * `DEFAULT (datetime('now'))` is fine in a `CREATE TABLE` and rejected by an
 * `ALTER` the moment the table holds a row — `Cannot add a column with
 * non-constant default`. A field carrying `computedDefault: 'now'` is exactly
 * the shape that trips it, and it is the flag the schema contract documents for
 * timestamps, so this is the likely case rather than the exotic one.
 *
 * Dropping the clause is safe and is what the rebuild expects anyway: the column
 * arrives NULL on existing rows and `indexAll()` fills it from the files
 * immediately afterwards, which is the same path a new NOT NULL field takes.
 * Emitting it would have made every populated project fail to open while every
 * fresh install worked.
 */
function alterableDefault(node: FieldNode): string | null {
  if (node.computedDefault !== undefined) return null;
  return defaultClause(node);
}

function addMissingColumns(
  db: Database,
  table: string,
  declared: Array<[string, FieldNode]>,
): string[] {
  if (!tableExists(db, table)) return [];
  const present = existingColumns(db, table);
  const added: string[] = [];
  for (const [name, node] of declared) {
    const column = columnOf(name, node);
    if (present.has(column)) continue;
    const def = alterableDefault(node);
    const parts = [column, sqlType(node)];
    if (def) parts.push(def);
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${parts.join(' ')};`);
    added.push(`${table}.${column}`);
  }
  return added;
}

/**
 * Columns the host owns, which are never a projection of a declared field and so
 * must never be read as one that went away.
 *
 * `slug` is the row's identity and comes from the envelope, not from
 * `data.schema`. A collection's projection row additionally carries its binding
 * column back to the parent and its ordinal.
 *
 * A FLOOR, NOT THE RULE. These names are what the six legacy tables happen to
 * carry; the sparing that MATTERS is derived from the declaration instead —
 * `localSurrogate` and `transientInput` fields are excluded from `isEmbedded`,
 * so their columns must be added back by the caller. A type declaring a
 * surrogate as `column: 'row_id'` is spared by that derivation, not by this set.
 */
const HOST_OWNED_COLUMNS = new Set(['slug', 'id', 'ord']);

/** Declared-but-unprojected fields: present in the schema, absent from `isEmbedded`. */
function unprojectedColumns(schema: Record<string, FieldNode>): string[] {
  return Object.entries(schema)
    .filter(([, node]) => node.localSurrogate || node.transientInput)
    .map(([name, node]) => columnOf(name, node));
}

/**
 * Drop columns the schema no longer declares.
 *
 * THE OTHER HALF OF "THE PROJECTION IS GENERATED". A generator that adds but
 * never removes does not compute `schema → DDL`; it computes a function of the
 * database's history, so two installs of one project diverge physically and the
 * regeneration this module claims is idempotent is not.
 *
 * It is also, concretely, a broken upgrade. A removed field's column keeps its
 * `NOT NULL` while the write path binds only DECLARED columns, so the very next
 * `indexAll()` fails with `NOT NULL constraint failed` — inside the single
 * rebuild transaction, which rolls the whole rebuild back and serves the project
 * from a permanently stale index. 0.2.27 removes `database-table.name` and would
 * have done exactly that to every existing project.
 *
 * SAFE BECAUSE THE FILES ARE THE TRUTH. Dropping a projection column destroys no
 * authored data: the column is derived, the entity files are authoritative, and
 * `indexAll()` refills from them immediately after. That is the same reasoning
 * that lets this module's docblock name "drop the table and rebuild" as the
 * recovery for anything it cannot do in place — this is the narrower, cheaper
 * version of that.
 *
 * Bounded twice, and both bounds are the contract's: never a host-owned column,
 * and never a table the generator did not create (the caller only ever passes it
 * generated tables).
 *
 * NEVER FATAL. SQLite refuses `DROP COLUMN` for a column an index or a
 * table-level `UNIQUE` still mentions, and this runs at `ProjectContext`
 * construction — an escaping throw does not degrade the index, it stops the
 * project OPENING, which is strictly worse than the stale column the drop exists
 * to remove. Generated indexes are dropped first (they are regenerated from the
 * current declaration on this same boot, so removing one is free); anything left
 * standing — a `UNIQUE` in the table definition, which only a rebuild can
 * rewrite — leaves the column in place and says so.
 */
function dropUndeclaredColumns(db: Database, table: string, declared: Set<string>): string[] {
  if (!tableExists(db, table)) return [];
  const dropped: string[] = [];
  for (const column of existingColumns(db, table)) {
    if (declared.has(column) || HOST_OWNED_COLUMNS.has(column)) continue;
    dropIndexesMentioning(db, table, column);
    try {
      db.exec(`ALTER TABLE ${table} DROP COLUMN ${column};`);
      dropped.push(`${table}.${column}`);
    } catch (err) {
      console.warn(
        `[projection] ${table}.${column} is no longer declared but could not be dropped: ` +
          `${(err as Error).message} — leaving it in place. If it is NOT NULL, the index ` +
          `rebuild will fail on it and the table needs recreating.`,
      );
    }
  }
  return dropped;
}

/**
 * Drop the generated indexes that mention a column, so its `DROP COLUMN` can go
 * through.
 *
 * Only `origin: 'c'` — an index this module CREATEd, and re-CREATEs from the
 * current `data.access` hints on the very same boot. An index SQLite owns
 * (`origin: 'u'`, a table-level `UNIQUE`; `'pk'`, the primary key) is left
 * alone: dropping it would silently discard a constraint the declaration still
 * asks for, and the caller handles the resulting refusal.
 */
function dropIndexesMentioning(db: Database, table: string, column: string): void {
  const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{
    name: string;
    origin: string;
  }>;
  for (const index of indexes) {
    if (index.origin !== 'c') continue;
    const columns = db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{
      name: string | null;
    }>;
    if (!columns.some((c) => c.name === column)) continue;
    db.exec(`DROP INDEX IF EXISTS ${index.name};`);
  }
}

/**
 * Additive reconciliation for tables that already exist — the parent row AND
 * every projection table.
 *
 * `CREATE TABLE IF NOT EXISTS` no-ops on an existing table, so a field ADDED to
 * a schema would otherwise never reach an existing database — the type would
 * write a column that is not there. `ALTER TABLE ADD COLUMN` closes that gap, and
 * `DROP COLUMN` closes its mirror image: a field REMOVED from the schema leaves a
 * column behind that the write path never binds, and if it was `NOT NULL` the
 * next rebuild fails on it. A RETYPED field is still left to the rebuild — that
 * one genuinely needs the files re-read rather than the table edited.
 *
 * Projection tables are reconciled too, and must be. An earlier revision covered
 * only the parent, which left a field added to a table-backed collection
 * unreachable on every upgraded install: the junction INSERT then throws `no
 * column named …` inside `indexAll`'s single rebuild transaction, rolling the
 * whole rebuild back and serving the project from a permanently stale index —
 * with no `ALTER TABLE` path left to repair it, since the retired per-plugin
 * migration chain was the only thing that could express one.
 *
 * SQLite refuses `ADD COLUMN ... NOT NULL` without a default, so a new required
 * field arrives nullable on existing databases and is made whole by the rebuild
 * that immediately follows.
 */
function reconcileColumns(db: Database, module: ProjectableModule): string[] {
  const schema = module.data?.schema;
  if (!schema) return [];
  const changed: string[] = [];

  const declaredColumns = (fields: Array<[string, FieldNode]>) =>
    new Set(fields.map(([name, node]) => columnOf(name, node)));

  const embedded = Object.entries(schema).filter(([, node]) => isEmbedded(node));
  const mainTable = mainTableOf(module);
  changed.push(...addMissingColumns(db, mainTable, embedded));
  const mainDeclared = declaredColumns(embedded);
  for (const column of unprojectedColumns(schema)) mainDeclared.add(column);
  changed.push(...dropUndeclaredColumns(db, mainTable, mainDeclared));

  for (const [name, node] of Object.entries(schema)) {
    if (!hasProjectionTable(node)) continue;
    const collection = node as CollectionNode;
    const item = collection.item;
    const itemFields: Array<[string, FieldNode]> =
      item.type === 'object' ? Object.entries(item.fields) : [['value', item]];
    const table = projectionTableOf(module, name, collection);
    changed.push(...addMissingColumns(db, table, itemFields));
    /**
     * A projection row's binding column back to its parent is host-owned, like
     * `slug` — it is not a projection of any declared item field, so it must be
     * spared explicitly or the first boot would drop the junction's own key.
     */
    const declared = declaredColumns(itemFields);
    declared.add(bindingColumnOf(module));
    for (const axis of collection.keyFields ?? []) declared.add(snakeCase(axis));
    changed.push(...dropUndeclaredColumns(db, table, declared));
  }

  return changed;
}

/**
 * Build the projection for every active type. Idempotent — safe on every boot.
 *
 * Runs in one transaction with foreign keys OFF, for the same reason the two
 * migration runners do: a projection table carries `ON DELETE CASCADE` to its
 * parent, and creating tables in dependency order is not something the caller
 * should have to guarantee.
 *
 * Returns what it actually changed, so the caller can log a real event instead
 * of "projection applied" on every boot.
 */
export function applyProjection(
  db: Database,
  modules: readonly ProjectableModule[],
): { created: string[]; alteredColumns: string[] } {
  const withSchema = modules.filter((m) => m.data?.schema);
  if (!withSchema.length) return { created: [], alteredColumns: [] };

  const created: string[] = [];
  for (const module of withSchema) {
    if (!tableExists(db, mainTableOf(module))) created.push(mainTableOf(module));
  }

  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
  if (fkWasOn) db.pragma('foreign_keys = OFF');
  const alteredColumns: string[] = [];
  try {
    db.transaction(() => {
      for (const module of withSchema) {
        for (const statement of generateProjectionDDL(module)) db.exec(statement);
      }
      // After every table exists, so a column added to a type that another type
      // references cannot run before the referenced table is there.
      for (const module of withSchema) alteredColumns.push(...reconcileColumns(db, module));
    })();
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON');
  }

  return { created, alteredColumns };
}

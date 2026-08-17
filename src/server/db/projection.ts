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
 * Additive reconciliation for tables that already exist — the parent row AND
 * every projection table.
 *
 * `CREATE TABLE IF NOT EXISTS` no-ops on an existing table, so a field ADDED to
 * a schema would otherwise never reach an existing database — the type would
 * write a column that is not there. `ALTER TABLE ADD COLUMN` closes exactly that
 * gap and nothing wider: a REMOVED or RETYPED field is left alone here and
 * resolved by the rebuild, because those are the changes that need the files to
 * be re-read rather than the table to be edited.
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
  const added: string[] = [];

  const embedded = Object.entries(schema).filter(([, node]) => isEmbedded(node));
  added.push(...addMissingColumns(db, mainTableOf(module), embedded));

  for (const [name, node] of Object.entries(schema)) {
    if (!hasProjectionTable(node)) continue;
    const collection = node as CollectionNode;
    const item = collection.item;
    const itemFields: Array<[string, FieldNode]> =
      item.type === 'object' ? Object.entries(item.fields) : [['value', item]];
    added.push(
      ...addMissingColumns(db, projectionTableOf(module, name, collection), itemFields),
    );
  }

  return added;
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

/**
 * THE hard gate of the 0.2.2 baseline cut, carried forward to Host API 2.0.0.
 *
 * A database created fresh (000_baseline.sql + the GENERATED entity projection)
 * must end up with the same schema as one that replayed the full historical
 * chain 000_init..049. A divergence between those two paths is a bug, not an
 * acceptable difference — it would mean two populations of installations running
 * against schemas that only look alike.
 *
 * 2.0.0 replaced the entity half of that comparison: the six `migrations.ts`
 * files are gone and their tables come from `applyProjection`. Two differences
 * are DELIBERATE and are asserted below as such rather than normalized away in
 * silence — see `EXPECTED_DELTAS`.
 *
 * The comparison is LOGICAL, never `sqlite_master.sql` text. The chain reached
 * its shape through `ALTER TABLE ... RENAME` and `ADD COLUMN`, which leaves
 * quoted table names and appended-column artifacts in the stored SQL that carry
 * no meaning. PRAGMA output is the semantics.
 *
 * Scope: unconditional. `mountBackend` migrates every AVAILABLE module, not just
 * the active ones, so narrowing `config.entities` does NOT shrink the schema — a
 * deactivated type keeps an empty table, exactly as it did when the DDL lived in
 * the host chain. An earlier revision migrated only active modules and a
 * deactivated `design-system` then had no table at all, which turned
 * `GET /entities/counts` into a 500.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/server/db/migrate.js';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../../src/server/serialization/registerAll.js';
import { applyProjection } from '../../../src/server/db/projection.js';
import { loadBuiltinEnvelopes } from '../../../src/server/core/plugin-host/loader.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '../../../src/server/db/migrations');

/**
 * Ledger tables and SQLite bookkeeping are not part of the comparison.
 *
 * `database_table` joins them in 0.2.11, and it is the one entry here that is a
 * real divergence rather than bookkeeping. The historical chain creates it
 * (`006_database_table.sql`), and the baseline used to as well — grandfathered,
 * because the type comes from an EXTERNAL plugin with no in-repo module to own
 * the DDL. That grandfathering was the last thing making `database-table` a
 * privileged type in the migration chain, so it is gone: the table now exists
 * only where the plugin contributing the type is installed, generated from its
 * `data.schema` like every other entity table.
 *
 * A legacy database keeps its copy (nothing drops it) and a fresh one without
 * that plugin has none — a deliberate, accepted divergence, and the only reason
 * these two schemas are no longer identical. Comparing it would assert the
 * privilege this release removed.
 */
const IGNORED = (name: string) =>
  name === 'schema_migrations' ||
  name === 'plugin_schema_migrations' ||
  name === 'sqlite_sequence' ||
  name === 'database_table' ||
  name.startsWith('sqlite_stat');

type TableShape = {
  columns: unknown[];
  foreignKeys: unknown[];
  indexes: unknown[];
};

function snapshotSchema(db: Database.Database): Record<string, TableShape> {
  const names = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>
  )
    .map((r) => r.name)
    .filter((n) => !IGNORED(n));

  const out: Record<string, TableShape> = {};
  for (const name of names) {
    // Positional: a column appended in the wrong place is a real difference.
    const columns = (db.pragma(`table_info("${name}")`) as Array<Record<string, unknown>>).map((c) => ({
      cid: c.cid,
      name: c.name,
      type: c.type,
      notnull: c.notnull,
      dflt_value: c.dflt_value,
      pk: c.pk,
    }));

    // Declaration order of FKs is not meaningful; sort to compare as a set.
    const foreignKeys = (db.pragma(`foreign_key_list("${name}")`) as Array<Record<string, unknown>>)
      .map((f) => ({ table: f.table, from: f.from, to: f.to, on_update: f.on_update, on_delete: f.on_delete }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

    // Auto-index names are derived from the PK/UNIQUE declarations, so they are
    // stable and worth comparing verbatim — that is what catches a lost UNIQUE.
    const indexes = (db.pragma(`index_list("${name}")`) as Array<Record<string, unknown>>)
      .map((i) => ({
        name: i.name,
        unique: i.unique,
        origin: i.origin,
        partial: i.partial,
        columns: (db.pragma(`index_info("${String(i.name)}")`) as Array<Record<string, unknown>>).map((c) => c.name),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    out[name] = { columns, foreignKeys, indexes };
  }
  return out;
}

/** A legacy database: the historical chain, applied file by file. */
function legacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  for (const file of fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f !== '000_baseline.sql')
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
  }
  return db;
}

/**
 * A fresh database: baseline, then the GENERATED projection of every module —
 * the four directly-built-in types AND the builtin envelopes, since `endpoint`,
 * `dto` and the junction moved into one. Loading the envelopes is what makes
 * this an apples-to-apples comparison with the chain.
 */
async function baselineDb(): Promise<Database.Database> {
  const db = new Database(':memory:');
  runMigrations(db);

  const registry = new PluginRegistryImpl();
  registerAllPlugins(registry);
  await loadBuiltinEnvelopes(registry);
  const host = registry.consolidate(null);
  // The same call ProjectContext makes, over the same set.
  applyProjection(db, host.listAvailable());
  return db;
}

/**
 * The two intentional shape changes of Host API 2.0.0, enumerated so a THIRD one
 * cannot slip in unnoticed. Normalizing the comparison without listing them
 * would turn this gate into a rubber stamp.
 *
 *  1. `slug` is `NOT NULL` on every entity table. Five of the six historically
 *     wrote `TEXT PRIMARY KEY` alone, and in SQLite that column accepts NULL —
 *     a long-standing compatibility quirk. The generator always spells the
 *     constraint out, so four tables that could hold a NULL-slugged row no
 *     longer can. Existing databases are unaffected: `CREATE TABLE IF NOT
 *     EXISTS` never fires on them.
 *  2. The junction's two secondary indexes are renamed to the generator's rule
 *     (`idx_endpoint_dto_endpoint` → `idx_endpoint_dto_endpoint_slug`, likewise
 *     for `_dto`). They cover the same columns; an index name is not a contract
 *     surface, since nothing queries by it.
 *  3. 0.2.22 — every entity table gains the reserved `title` column, and `dto`
 *     loses the `name` it replaced. A legacy database reaches the same shape
 *     through `reconcileColumns`, which ADDs the column at boot (nullable, since
 *     SQLite refuses `ADD COLUMN NOT NULL` without a default) and lets the
 *     rebuild fill it from the files. This delta is applied to the LEGACY side
 *     so the rest of each table still compares strictly.
 */
const RENAMED_INDEXES: Record<string, string> = {
  idx_endpoint_dto_endpoint: 'idx_endpoint_dto_endpoint_slug',
  idx_endpoint_dto_dto: 'idx_endpoint_dto_dto_slug',
};

/**
 * The tables the generator owns. The deltas apply to these and ONLY these —
 * scoping matters: the host's own baseline tables are untouched by 2.0.0, and
 * blanket-normalizing every primary key would hide a real change to one of them.
 */
const PROJECTED_TABLES = new Set([
  'ac',
  'ui_view',
  'design_system',
  'diagram',
  'dto',
  'endpoint',
  'endpoint_dto',
]);

/**
 * Tables that exist ONLY in the fresh database, because their type shipped after
 * the historical chain was frozen.
 *
 * This is not a delta to normalize away — there is nothing on the legacy side to
 * compare them against — so they are removed from the comparison outright. Named
 * one by one for the same reason the deltas are: a type added later must be
 * listed here deliberately, not swept in by a pattern, or the gate stops being
 * able to see a table appearing that nobody meant to add. Their presence is
 * asserted separately below, so excluding them cannot hide them going missing.
 */
const NEW_SINCE_LEGACY = new Set([
  'spreadsheet',
  'spreadsheet_cells',
  'mcp_tool',
  // 0.2.45 — `code-snippet`, contributed by `c4s-plugin-code-snippets`.
  'code_snippet',
]);

const withoutNewTables = (schema: Record<string, TableShape>): Record<string, TableShape> =>
  Object.fromEntries(Object.entries(schema).filter(([table]) => !NEW_SINCE_LEGACY.has(table)));

/**
 * Columns a type declared AFTER the historical chain was frozen, appended to the
 * legacy side so the rest of the table still compares strictly.
 *
 * The table-level twin above removes a whole table from the comparison; this is
 * the narrower case, and it is listed column by column for the same reason: a
 * column appearing that nobody meant to add must still fail this gate. The
 * generator appends, so the expected position is the end.
 *
 * `ui_view.mockup_html` (0.2.27) — the mockup. `contentBearing` keeps a field out
 * of READS, not out of the projection.
 */
const NEW_COLUMNS_SINCE_LEGACY: Record<string, Array<Record<string, unknown>>> = {
  ui_view: [{ name: 'mockup_html', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 }],
};

/**
 * The reserved column, in the position the generator emits it: first among the
 * declared fields, i.e. straight after `slug`.
 */
const TITLE_COLUMN = { name: 'title', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 };

/**
 * The types whose legacy `name` column was REPLACED by `title` rather than
 * joined by it. `database_table` is deliberately absent — it is the one type
 * where the two coexist, because its `name` is a SQL identifier.
 */
const RENAMED_TO_TITLE = new Set(['dto', 'design_system', 'ui_view']);

/** Apply the known deltas to the LEGACY snapshot so the rest compares strictly. */
function applyExpectedDeltas(schema: Record<string, TableShape>): Record<string, TableShape> {
  const out: Record<string, TableShape> = {};
  for (const [table, shape] of Object.entries(schema)) {
    if (!PROJECTED_TABLES.has(table)) {
      out[table] = shape;
      continue;
    }
    const withoutRenamed = RENAMED_TO_TITLE.has(table)
      ? shape.columns.filter((c) => (c as { name: string }).name !== 'name')
      : shape.columns;
    // `endpoint_dto` is a junction, not an entity: it has no title.
    const withTitle =
      table === 'endpoint_dto'
        ? withoutRenamed
        : [withoutRenamed[0], TITLE_COLUMN, ...withoutRenamed.slice(1)];
    const withAdded = [...withTitle, ...(NEW_COLUMNS_SINCE_LEGACY[table] ?? [])];
    out[table] = {
      ...shape,
      columns: withAdded.map((c, cid) => {
        const col = c as { pk: number; notnull: number };
        // `cid` is positional and every insertion shifts it, so it is restamped
        // rather than compared as authored.
        return { ...col, cid, ...(col.pk === 1 ? { notnull: 1 } : {}) };
      }),
      indexes: shape.indexes
        .map((i) => {
          const idx = i as { name: string };
          const renamed = RENAMED_INDEXES[idx.name];
          return renamed ? { ...idx, name: renamed } : idx;
        })
        .sort((a, b) => String((a as { name: string }).name).localeCompare(String((b as { name: string }).name))),
    };
  }
  return out;
}

describe('000_baseline.sql', () => {
  it('produces the same schema as the full historical chain, once the projection is applied', async () => {
    const legacy = legacyDb();
    const fresh = await baselineDb();
    try {
      expect(withoutNewTables(snapshotSchema(fresh))).toEqual(applyExpectedDeltas(snapshotSchema(legacy)));
    } finally {
      legacy.close();
      fresh.close();
    }
  });

  it('still projects the tables excluded from that comparison', async () => {
    // The exclusion above is scoped to "the legacy chain has no counterpart",
    // not to "do not check these" — without this case, deleting the spreadsheet
    // envelope's projection entirely would leave the suite green.
    const fresh = await baselineDb();
    try {
      const tables = Object.keys(snapshotSchema(fresh));
      for (const table of NEW_SINCE_LEGACY) expect(tables).toContain(table);
    } finally {
      fresh.close();
    }
  });

  it('carries no entity table of its own — those belong to the contributing modules', () => {
    const db = new Database(':memory:');
    try {
      runMigrations(db);
      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
      ).map((r) => r.name);

      for (const entityTable of ['endpoint', 'dto', 'endpoint_dto', 'ui_view', 'ac', 'design_system', 'diagram']) {
        expect(tables).not.toContain(entityTable);
      }
      // 0.2.11: `database_table` is no longer grandfathered in. It was the last
      // entity table the baseline created without owning; it now comes from the
      // external plugin that contributes the type, like every other one.
      expect(tables).not.toContain('database_table');
      // Host tables are all here.
      expect(tables).toEqual(expect.arrayContaining(['tag', 'entity_tag', 'entity_version', 'file_version', 'spec_release', 'section_index']));
    } finally {
      db.close();
    }
  });
});

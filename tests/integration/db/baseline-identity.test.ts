/**
 * THE hard gate of the 0.2.2 baseline cut.
 *
 * A database created fresh (000_baseline.sql + every core module's
 * `backend.migrations`) must end up with the same schema as one that replayed
 * the full historical chain 000_init..049. A divergence between those two paths
 * is a bug, not an acceptable difference — it would mean two populations of
 * installations running against schemas that only look alike.
 *
 * The comparison is LOGICAL, never `sqlite_master.sql` text. The chain reached
 * its shape through `ALTER TABLE ... RENAME` and `ADD COLUMN`, which leaves
 * quoted table names and appended-column artifacts in the stored SQL that carry
 * no meaning. PRAGMA output is the semantics.
 *
 * Scope: the gate holds for "baseline + ALL core modules active". A project
 * that narrows `config.entities` gets a strictly smaller schema, by design.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/server/db/migrate.js';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../../src/server/serialization/registerAll.js';
import { runPluginMigrations } from '../../../src/server/core/plugin-host/plugin-migrate.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '../../../src/server/db/migrations');

/** Ledger tables and SQLite bookkeeping are not part of the comparison. */
const IGNORED = (name: string) =>
  name === 'schema_migrations' ||
  name === 'plugin_schema_migrations' ||
  name === 'sqlite_sequence' ||
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

/** A fresh database: baseline, then every core module's own migrations. */
function baselineDb(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);

  const registry = new PluginRegistryImpl();
  registerAllPlugins(registry);
  const host = registry.consolidate(null);
  // Same two-pass order as ProjectPluginHost.mountBackend.
  for (const m of host.listEntities()) runPluginMigrations(db, m.type, m.backend?.migrations);
  return db;
}

describe('000_baseline.sql', () => {
  it('produces the same schema as the full historical chain, once modules have migrated', () => {
    const legacy = legacyDb();
    const fresh = baselineDb();
    try {
      expect(snapshotSchema(fresh)).toEqual(snapshotSchema(legacy));
    } finally {
      legacy.close();
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
      // Grandfathered: contributed by an external plugin, so no in-repo module
      // can own its DDL. See the note in 000_baseline.sql.
      expect(tables).toContain('database_table');
      // Host tables are all here.
      expect(tables).toEqual(expect.arrayContaining(['tag', 'entity_tag', 'entity_version', 'file_version', 'spec_release', 'section_index']));
    } finally {
      db.close();
    }
  });
});

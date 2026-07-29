import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runPluginMigrations, PluginSchemaCollisionError, tablesCreatedBy } from './plugin-migrate.js';
import type { SqlMigration } from './types.js';

const exampleMigrations: SqlMigration[] = [
  {
    version: 1,
    name: 'create_example_entity',
    up: `
      CREATE TABLE IF NOT EXISTS example_entity (
        slug TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_example_entity_name ON example_entity (name);
    `,
  },
];

describe('runPluginMigrations', () => {
  it('creates the plugin table and records the version in the ledger', () => {
    const db = new Database(':memory:');
    runPluginMigrations(db, 'example_entity', exampleMigrations);

    // Table exists and is queryable (the original "no such table" repro).
    expect(() => db.prepare('SELECT slug, name FROM example_entity').all()).not.toThrow();

    const rows = db
      .prepare('SELECT plugin, version, name FROM plugin_schema_migrations')
      .all() as Array<{ plugin: string; version: number; name: string }>;
    expect(rows).toEqual([
      { plugin: 'example_entity', version: 1, name: 'create_example_entity' },
    ]);
    db.close();
  });

  it('is idempotent: a second run applies nothing and does not throw', () => {
    const db = new Database(':memory:');
    runPluginMigrations(db, 'example_entity', exampleMigrations);
    expect(() => runPluginMigrations(db, 'example_entity', exampleMigrations)).not.toThrow();

    const count = db
      .prepare("SELECT COUNT(*) AS n FROM plugin_schema_migrations WHERE plugin = 'example_entity'")
      .get() as { n: number };
    expect(count.n).toBe(1);
    db.close();
  });

  it('keys the ledger per plugin so two plugins can share version numbers', () => {
    const db = new Database(':memory:');
    runPluginMigrations(db, 'example_entity', exampleMigrations);
    runPluginMigrations(db, 'other_entity', [
      { version: 1, name: 'create_other', up: 'CREATE TABLE IF NOT EXISTS other (id INTEGER PRIMARY KEY);' },
    ]);

    const rows = db
      .prepare('SELECT plugin FROM plugin_schema_migrations ORDER BY plugin')
      .all() as Array<{ plugin: string }>;
    expect(rows.map((r) => r.plugin)).toEqual(['example_entity', 'other_entity']);
    db.close();
  });

  it('applies pending migrations in version order and skips already-applied ones', () => {
    const db = new Database(':memory:');
    runPluginMigrations(db, 'p', exampleMigrations);
    // Add a v2 alongside the already-applied v1 — only v2 should run.
    runPluginMigrations(db, 'p', [
      ...exampleMigrations,
      { version: 2, name: 'add_data_column', up: 'ALTER TABLE example_entity ADD COLUMN data TEXT;' },
    ]);

    const versions = db
      .prepare("SELECT version FROM plugin_schema_migrations WHERE plugin = 'p' ORDER BY version")
      .all() as Array<{ version: number }>;
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    // The v2 column is present.
    const cols = db.prepare('PRAGMA table_info(example_entity)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('data');
    db.close();
  });

  it('is a no-op for a plugin with no declared migrations', () => {
    const db = new Database(':memory:');
    expect(() => runPluginMigrations(db, 'no_backend', undefined)).not.toThrow();
    expect(() => runPluginMigrations(db, 'empty', [])).not.toThrow();
    // Ledger table is not even created when there is nothing to apply.
    const ledger = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plugin_schema_migrations'")
      .get();
    expect(ledger).toBeUndefined();
    db.close();
  });
});

describe('schema-ownership collision detection', () => {
  it('rejects a plugin migration that redefines a core host table', () => {
    const db = new Database(':memory:');
    expect(() =>
      runPluginMigrations(db, 'squatter', [
        { version: 1, name: 'steal', up: 'CREATE TABLE IF NOT EXISTS chat_thread (id TEXT PRIMARY KEY);' },
      ]),
    ).toThrow(PluginSchemaCollisionError);

    // Rejected before anything touched the database.
    const ledger = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plugin_schema_migrations'")
      .get();
    expect(ledger).toBeUndefined();
    db.close();
  });

  it('allows a plugin to own a table the baseline does not claim', () => {
    const db = new Database(':memory:');
    expect(() => runPluginMigrations(db, 'p', exampleMigrations)).not.toThrow();
    db.close();
  });

  it('allows database_table — grandfathered, since the baseline still creates it', () => {
    const db = new Database(':memory:');
    expect(() =>
      runPluginMigrations(db, 'database-table', [
        { version: 1, name: 'create', up: 'CREATE TABLE IF NOT EXISTS database_table (slug TEXT PRIMARY KEY);' },
      ]),
    ).not.toThrow();
    db.close();
  });

  it('does not trip on a core table named only in a comment', () => {
    expect(tablesCreatedBy('-- unlike chat_thread, this one is ours\nCREATE TABLE mine (a TEXT);')).toEqual(['mine']);
    expect(tablesCreatedBy('/* CREATE TABLE tag ... */ CREATE TABLE mine (a TEXT);')).toEqual(['mine']);
  });

  it('sees through quoting and IF NOT EXISTS', () => {
    expect(tablesCreatedBy('CREATE TABLE IF NOT EXISTS "tag" (a TEXT); CREATE TABLE [plan] (b TEXT);')).toEqual([
      'tag',
      'plan',
    ]);
  });
});

/**
 * The upgrade path: a database created BEFORE 0.2.2 must survive the split.
 *
 * The baseline cut is only half the change. The other half is that every entity
 * table an existing installation already has — built by the historical chain —
 * is now claimed by a module that will run its own `CREATE TABLE` against it.
 * Three things have to be true at once, and each has its own way of going wrong:
 *
 *   1. the baseline never runs (it would fail: plain CREATE TABLE, no IF NOT EXISTS);
 *   2. the module migrations no-op instead of erroring, and record themselves as
 *      applied, so the module takes ownership going forward;
 *   3. nothing in the data is touched.
 *
 * (3) is the one worth a test rather than an argument. `IF NOT EXISTS` makes
 * adoption invisible, and an invisible operation that silently DROPPED and
 * recreated a table would look identical here until you checked the rows.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/server/db/migrate.js';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../../src/server/serialization/registerAll.js';
import { loadBuiltinEnvelopes } from '../../../src/server/core/plugin-host/loader.js';
import { runPluginMigrations } from '../../../src/server/core/plugin-host/plugin-migrate.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '../../../src/server/db/migrations');

/** A database as an installation running the previous release would have it. */
function legacyInstallation(): Database.Database {
  const db = new Database(':memory:');
  db.exec(
    `CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`,
  );
  const record = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
  db.pragma('foreign_keys = OFF');
  for (const file of fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f !== '000_baseline.sql')
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
    record.run(file.replace(/\.sql$/, ''));
  }
  db.pragma('foreign_keys = ON');
  return db;
}

describe('upgrading a pre-0.2.2 database', () => {
  it('adopts existing entity tables without running the baseline or losing data', async () => {
    const db = legacyInstallation();
    try {
      // Real rows, including a junction row, so an accidental table rebuild shows.
      db.exec(`
        INSERT INTO dto (slug, name, fields, examples, created_at, updated_at)
          VALUES ('user-dto', 'UserDto', '[]', '[]', '2024-01-01', '2024-01-01');
        INSERT INTO endpoint (slug, method, path, summary, created_at, updated_at)
          VALUES ('get-users', 'GET', '/users', 'List', '2024-01-01', '2024-01-01');
        INSERT INTO endpoint_dto (endpoint_slug, dto_slug, relation, status_code)
          VALUES ('get-users', 'user-dto', 'response', 200);
        INSERT INTO ac (slug, text, created_at, updated_at)
          VALUES ('ac-one', 'something holds', '2024-01-01', '2024-01-01');
      `);

      // The upgrade itself: host chain first, then every module's own schema.
      const applied = runMigrations(db);
      const registry = new PluginRegistryImpl();
      registerAllPlugins(registry);
      await loadBuiltinEnvelopes(registry);
      const host = registry.consolidate(null);
      const modules = host.listEntities();
      expect(() => {
        for (const m of modules) runPluginMigrations(db, m.type, m.backend?.migrations);
      }).not.toThrow();

      // 1. The baseline stayed out of it — this database is on the legacy path
      //    forever, and that is the intended outcome, not a fallback.
      expect(applied).toEqual([]);
      const versions = (
        db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>
      ).map((r) => r.version);
      expect(versions).not.toContain('000_baseline');

      // 2. Each module recorded its adoption, so it owns the table from here.
      const ledger = db
        .prepare('SELECT plugin, version FROM plugin_schema_migrations ORDER BY plugin, version')
        .all() as Array<{ plugin: string; version: number }>;
      expect(ledger.map((r) => r.plugin)).toEqual(
        expect.arrayContaining(['endpoint', 'dto', 'ui-view', 'ac', 'design-system', 'diagram']),
      );
      // `endpoint` carries two: the table, then the junction.
      expect(ledger.filter((r) => r.plugin === 'endpoint').map((r) => r.version)).toEqual([1, 2]);

      // 3. Nothing was touched.
      expect(db.prepare('SELECT name FROM dto WHERE slug = ?').get('user-dto')).toEqual({
        name: 'UserDto',
      });
      expect(db.prepare('SELECT summary FROM endpoint WHERE slug = ?').get('get-users')).toEqual({
        summary: 'List',
      });
      expect(
        db.prepare('SELECT status_code FROM endpoint_dto WHERE endpoint_slug = ?').get('get-users'),
      ).toEqual({ status_code: 200 });
      expect(db.prepare('SELECT text FROM ac WHERE slug = ?').get('ac-one')).toEqual({
        text: 'something holds',
      });
    } finally {
      db.close();
    }
  });

  it('is idempotent — a second mount applies nothing further', async () => {
    const db = legacyInstallation();
    try {
      const registry = new PluginRegistryImpl();
      registerAllPlugins(registry);
      await loadBuiltinEnvelopes(registry);
      const modules = registry.consolidate(null).listEntities();
      const migrate = () => {
        for (const m of modules) runPluginMigrations(db, m.type, m.backend?.migrations);
      };

      migrate();
      const first = db.prepare('SELECT COUNT(*) AS n FROM plugin_schema_migrations').get() as { n: number };
      migrate();
      const second = db.prepare('SELECT COUNT(*) AS n FROM plugin_schema_migrations').get() as { n: number };

      expect(second.n).toBe(first.n);
    } finally {
      db.close();
    }
  });
});

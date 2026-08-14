/**
 * The upgrade path: a database created BEFORE the split must survive it.
 *
 * 0.2.2 moved entity DDL out of the host chain and into each module; Host API
 * 2.0.0 removes the module's DDL too and GENERATES the table from
 * `data.schema`. An existing installation therefore meets a third writer for
 * tables it has had all along. Three things have to be true at once, and each
 * has its own way of going wrong:
 *
 *   1. the baseline never runs (it would fail: plain CREATE TABLE, no IF NOT EXISTS);
 *   2. `applyProjection` no-ops on every existing table instead of erroring, and
 *      alters nothing — the generated shape already matches, which is what
 *      `projection.golden.test.ts` proves column by column;
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
import { applyProjection } from '../../../src/server/db/projection.js';

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

      // The upgrade itself: host chain first, then the generated projection.
      const applied = runMigrations(db);
      const registry = new PluginRegistryImpl();
      registerAllPlugins(registry);
      await loadBuiltinEnvelopes(registry);
      const host = registry.consolidate(null);
      let result!: ReturnType<typeof applyProjection>;
      expect(() => {
        result = applyProjection(db, host.listAvailable());
      }).not.toThrow();

      // 1. The baseline stayed out of it — this database is on the legacy path
      //    forever, and that is the intended outcome, not a fallback.
      expect(applied).toEqual([]);
      const versions = (
        db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>
      ).map((r) => r.version);
      expect(versions).not.toContain('000_baseline');

      // 2. The projection ADOPTED every table this database already had, and
      //    altered nothing. This is the assertion that would catch a generated
      //    schema disagreeing with the historical one: a column the old chain
      //    never wrote would show up here as an ALTER, silently changing a table
      //    under live data.
      //
      //    `created` is not empty, and must not be: a type this database predates
      //    has no table to adopt, so creating one is the correct outcome rather
      //    than a rebuild. `spreadsheet` shipped after this legacy schema was
      //    frozen. What matters is that nothing the legacy chain DID write is in
      //    the list.
      const legacyTables = ['dto', 'endpoint', 'ac'];
      expect(result.created).not.toEqual(expect.arrayContaining(legacyTables));
      expect(result.created).toEqual(['spreadsheet']);
      /**
       * 0.2.22 — the adopted tables gain the reserved `title` column, and that
       * is the point of `reconcileColumns`: a legacy database reaches the new
       * shape by an ADD COLUMN at boot rather than by a rebuild that would
       * discard the rows this test just checked are intact. `dto` also keeps its
       * now-unused `name` column, since a removed field is resolved by the
       * rebuild from files, never by dropping a column underneath a running
       * install.
       */
      expect(result.alteredColumns).toEqual(
        expect.arrayContaining(['endpoint.title', 'dto.title', 'ac.title']),
      );

      // 3. The retired ledger is gone, dropped by the host chain rather than
      //    left behind to be mistaken for authoritative.
      expect(
        db
          .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plugin_schema_migrations'`)
          .get(),
      ).toBeUndefined();

      // 4. Nothing was touched.
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

  it('is idempotent — a second boot changes nothing further', async () => {
    const db = legacyInstallation();
    try {
      const registry = new PluginRegistryImpl();
      registerAllPlugins(registry);
      await loadBuiltinEnvelopes(registry);
      const modules = registry.consolidate(null).listAvailable();

      applyProjection(db, modules);
      const second = applyProjection(db, modules);

      // Idempotency without a ledger: the generator asks the database what it
      // already has rather than reading a record of what it once did. That is
      // strictly stronger — a ledger can disagree with the schema it describes,
      // and this cannot.
      expect(second).toEqual({ created: [], alteredColumns: [] });
    } finally {
      db.close();
    }
  });
});

/**
 * Deactivating a type must not change the SCHEMA — only what is mounted.
 *
 * Regression, found by a browser pass rather than by any unit test: with entity
 * DDL moved into `backend.migrations`, migrating only ACTIVE modules meant a
 * deactivated type had no table at all, and `GET /entities/counts` — a walker
 * over every AVAILABLE type — returned 500 for the whole sidebar, every badge,
 * every type.
 *
 * 2.0.0 keeps the property and moves where it is enforced: `applyProjection` is
 * called with `listAvailable()`, so the schema is a function of what is
 * INSTALLED rather than of what is enabled. The two-pass loop in `mountBackend`
 * that used to carry this is gone.
 */
describe('a deactivated type keeps its (empty) table', () => {
  it('projects every available module, not only the active ones', async () => {
    const db = new Database(':memory:');
    try {
      runMigrations(db);
      const registry = new PluginRegistryImpl();
      registerAllPlugins(registry);
      await loadBuiltinEnvelopes(registry);

      // A project that enables only `endpoint` — everything else is available
      // but deactivated.
      const host = registry.consolidate({ entities: ['endpoint'] });
      expect(host.listEntities().map((m) => m.type)).toEqual(['endpoint']);

      applyProjection(db, host.listAvailable());

      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
      ).map((r) => r.name);

      // Present despite being deactivated — this is the assertion that failed.
      for (const table of ['ui_view', 'ac', 'design_system', 'diagram', 'dto']) {
        expect(tables).toContain(table);
      }
      expect(tables).toContain('endpoint');
    } finally {
      db.close();
    }
  });
});

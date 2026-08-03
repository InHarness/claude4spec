import Database from 'better-sqlite3';
import { runMigrations } from '../../src/server/db/migrate.js';
import { applyProjection } from '../../src/server/db/projection.js';
import { PluginRegistryImpl } from '../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../src/server/serialization/registerAll.js';

/**
 * A complete project database: host schema + the projection of every core type.
 *
 * Host API 2.0.0 collapsed the two runners into one asymmetric pair. The host
 * chain (`runMigrations`) still owns the host's own tables; entity tables are no
 * longer migrated at all — they are GENERATED from each type's `data.schema` by
 * `applyProjection`, exactly as `ProjectContext` does at boot.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  applyCoreEntityProjection(db);
  return db;
}

/**
 * The entity-projection half, for tests that build their database some other way.
 *
 * Covers the DIRECTLY built-in types only. `endpoint` and `dto` moved into a
 * builtin envelope in 0.2.2, and the loader imports built bundles asynchronously
 * — a synchronous helper cannot reach them. A test that needs those two tables
 * should build its world with `createTestApp`, which loads the envelopes.
 */
export function applyCoreEntityProjection(db: Database.Database): void {
  const registry = new PluginRegistryImpl();
  registerAllPlugins(registry);
  const host = registry.consolidate(null);
  applyProjection(db, host.listAvailable());
}

/** @deprecated 2.0.0 — renamed with the mechanism it wraps. */
export const applyCoreEntityMigrations = applyCoreEntityProjection;

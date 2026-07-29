import Database from 'better-sqlite3';
import { runMigrations } from '../../src/server/db/migrate.js';
import { PluginRegistryImpl } from '../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../src/server/serialization/registerAll.js';
import { runPluginMigrations } from '../../src/server/core/plugin-host/plugin-migrate.js';

/**
 * A complete project database: host schema + every core module's own schema.
 *
 * Since 0.2.2 those are two separate runners. `runMigrations` alone creates the
 * host tables and nothing else — entity tables now belong to the module that
 * contributes the type and arrive through `mountBackend`. Callers of this
 * helper want a database they can write entities into, so it does both, in the
 * same two-pass order the real host uses.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  applyCoreEntityMigrations(db);
  return db;
}

/** The entity-schema half, for tests that build their database some other way. */
export function applyCoreEntityMigrations(db: Database.Database): void {
  const registry = new PluginRegistryImpl();
  registerAllPlugins(registry);
  const host = registry.consolidate(null);
  for (const m of host.listEntities()) runPluginMigrations(db, m.type, m.backend?.migrations);
}

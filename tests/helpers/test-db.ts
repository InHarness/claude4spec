import Database from 'better-sqlite3';
import { runMigrations } from '../../src/server/db/migrate.js';

/**
 * The host's own schema — the host migration chain, and nothing else.
 *
 * Host API 2.0.0 collapsed the two runners into one asymmetric pair. The host
 * chain (`runMigrations`) owns the host's own tables; entity tables are not
 * migrated at all — they are GENERATED from each type's `data.schema` by
 * `applyProjection`, exactly as `ProjectContext` does at boot.
 *
 * 2.1.63: no entity table here any more. This helper used to project the
 * directly built-in types; that tier is empty now (`diagram`, its last type,
 * ships in the prebuilt envelope), and every type arrives through the loader,
 * which imports bundles asynchronously. A test that needs entity tables builds
 * its world with `createTestApp`, or applies `applyProjection` itself over the
 * modules it registers.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

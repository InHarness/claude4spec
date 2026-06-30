/**
 * L1 (M13): run a plugin's declared `backend.migrations` against the per-project
 * db, tracked per plugin in `plugin_schema_migrations`. The host parses
 * `backend.migrations` (manifest-adapter) but historically never executed them —
 * only `backend.mount(ctx)` ran, so a plugin's table was never created unless a
 * built-in host migration happened to create it. This restores the L1 contract:
 * "Host wykonuje je w mountBackend(...) … schema_version per plugin".
 *
 * Idempotent: re-mount after ProjectContext dispose skips already-applied
 * versions, and the migration SQL itself is authored `CREATE TABLE IF NOT EXISTS`.
 */

import type { Database } from 'better-sqlite3';
import type { SqlMigration } from './types.js';

export function runPluginMigrations(
  db: Database,
  plugin: string,
  migrations: SqlMigration[] | undefined,
): void {
  if (!migrations || migrations.length === 0) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_schema_migrations (
      plugin     TEXT NOT NULL,
      version    INTEGER NOT NULL,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (plugin, version)
    );
  `);

  const applied = new Set(
    db
      .prepare('SELECT version FROM plugin_schema_migrations WHERE plugin = ?')
      .all(plugin)
      .map((r) => (r as { version: number }).version),
  );

  const pending = [...migrations]
    .sort((a, b) => a.version - b.version)
    .filter((m) => !applied.has(m.version));

  for (const m of pending) {
    const tx = db.transaction(() => {
      db.exec(m.up);
      db.prepare(
        'INSERT INTO plugin_schema_migrations (plugin, version, name) VALUES (?, ?, ?)',
      ).run(plugin, m.version, m.name);
    });
    tx();
  }
}

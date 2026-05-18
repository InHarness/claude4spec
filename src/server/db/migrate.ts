import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export function runMigrations(db: Database.Database): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => (r as { version: string }).version)
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pending = files.filter((f) => !applied.has(f.replace(/\.sql$/, '')));
  if (pending.length === 0) return [];

  // Schema-changing migrations may rebuild a table that has incoming foreign
  // keys (e.g. relaxing a CHECK constraint forces a full table rebuild).
  // SQLite's recommended table-rebuild procedure requires foreign keys
  // disabled — otherwise DROP of the old parent table cascade-deletes child
  // rows via ON DELETE CASCADE. `PRAGMA foreign_keys` is a no-op inside a
  // transaction, so toggle it around the whole batch (each migration still
  // runs in its own transaction).
  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
  if (fkWasOn) db.pragma('foreign_keys = OFF');

  const newlyApplied: string[] = [];
  try {
    for (const file of pending) {
      const version = file.replace(/\.sql$/, '');
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      const tx = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
      });
      tx();
      newlyApplied.push(version);
    }
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON');
  }

  return newlyApplied;
}

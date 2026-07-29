import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * The baseline cut (0.2.2). It is NOT part of the ledger-driven chain — it
 * sorts lexicographically before `000_init` and would otherwise replay on every
 * existing database. It runs on exactly one condition: an empty ledger.
 *
 * Never rename or renumber this file. The `000_baseline` ledger row is the only
 * marker distinguishing a squashed database from a legacy one.
 */
const BASELINE_FILE = '000_baseline.sql';
const BASELINE_VERSION = '000_baseline';

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
  const chain = files.filter((f) => f !== BASELINE_FILE);

  // Fresh database: the baseline IS the schema. Pre-seed the whole historical
  // chain as applied so a fresh project never reconstructs history — and do it
  // in ONE transaction with the baseline itself, so a crash can never leave a
  // half-built schema described by a fully-seeded ledger.
  //
  // No foreign_keys toggle here: the baseline is pure CREATE TABLE / CREATE
  // INDEX with no table rebuilds, and SQLite resolves a forward FK reference at
  // DML time, not at CREATE time.
  if (applied.size === 0) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, BASELINE_FILE), 'utf-8');
    const insert = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
    db.transaction(() => {
      db.exec(sql);
      insert.run(BASELINE_VERSION);
      for (const file of chain) insert.run(file.replace(/\.sql$/, ''));
    })();
    // Only the baseline was APPLIED; the rest were recorded. Callers log this.
    return [BASELINE_VERSION];
  }

  const pending = chain.filter((f) => !applied.has(f.replace(/\.sql$/, '')));
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

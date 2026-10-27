import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

/**
 * 2.1.55 (M25 removed) — the release-push audit log `release_push` is dropped
 * with the feature; `remote_session` (M24) keeps the record's columns and its
 * unique index, untouched by the drop.
 */
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION = '059_drop_release_push.sql';

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number };

const tableExists = (db: Database.Database, name: string): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

const indexNames = (db: Database.Database): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((r) => r.name);

/** A database that replayed the chain up to (not including) 059 — a pre-2.1.55 install. */
function legacyDbBefore059(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  for (const file of fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f !== '000_baseline.sql' && f < MIGRATION)
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
  }
  return db;
}

/** The `remote_session` columns as the record states them: name, type, NOT NULL, default, pk. */
const REMOTE_SESSION_COLUMNS: Array<Omit<ColumnInfo, 'dflt_value'> & { dflt: string | null }> = [
  { name: 'id', type: 'INTEGER', notnull: 0, dflt: null, pk: 1 },
  { name: 'access_token', type: 'TEXT', notnull: 1, dflt: null, pk: 0 },
  { name: 'token_id', type: 'TEXT', notnull: 1, dflt: null, pk: 0 },
  { name: 'issued_at', type: 'TEXT', notnull: 1, dflt: null, pk: 0 },
  { name: 'remote_account_id', type: 'TEXT', notnull: 1, dflt: null, pk: 0 },
  { name: 'account_email', type: 'TEXT', notnull: 1, dflt: null, pk: 0 },
  { name: 'account_status', type: 'TEXT', notnull: 1, dflt: null, pk: 0 },
  { name: 'connected_at', type: 'TEXT', notnull: 1, dflt: "datetime('now')", pk: 0 },
  { name: 'created_at', type: 'TEXT', notnull: 1, dflt: "datetime('now')", pk: 0 },
  { name: 'updated_at', type: 'TEXT', notnull: 1, dflt: "datetime('now')", pk: 0 },
];

function expectRemoteSessionAsRecorded(db: Database.Database): void {
  const cols = (db.pragma('table_info(remote_session)') as ColumnInfo[]).map((c) => ({
    name: c.name,
    type: c.type,
    notnull: c.notnull,
    // SQLite reports `DEFAULT (datetime('now'))` with or without the outer parentheses.
    dflt: c.dflt_value == null ? null : String(c.dflt_value).replace(/^\((.*)\)$/, '$1'),
    pk: c.pk,
  }));
  expect(cols).toEqual(REMOTE_SESSION_COLUMNS);
  // No column naming a remote project — the session describes the account only.
  expect(cols.map((c) => c.name).some((n) => n.includes('project'))).toBe(false);
  const unique = (db.pragma('index_list(remote_session)') as Array<{ name: string; unique: number }>).find(
    (i) => i.name === 'uq_remote_session_remote_account_id',
  );
  expect(unique?.unique).toBe(1);
  expect((db.pragma('index_info(uq_remote_session_remote_account_id)') as Array<{ name: string }>).map((c) => c.name)).toEqual([
    'remote_account_id',
  ]);
}

describe('059 — release_push dropped, remote_session as recorded', () => {
  it('[entity:release-push] a fresh database has no release_push table and none of its indexes', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(tableExists(db, 'release_push')).toBe(false);
    expect(indexNames(db).filter((n) => n.startsWith('idx_release_push_'))).toEqual([]);
    db.close();
  });

  it('[entity:release-push] an existing database loses release_push (rows and indexes) after migrating; its releases stay', () => {
    const db = legacyDbBefore059();
    db.prepare(
      `INSERT INTO spec_release (name, slug, description, created_by, created_at) VALUES ('v1', 'v1', 'first', 'user', '2026-10-01T10:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO release_push (release_id, content_sha256, content_size_bytes, pushed_by_account_id, bundle_schema_version, status)
       VALUES (1, '${'a'.repeat(64)}', 10, 'acc', 1, 'success')`,
    ).run();
    expect(tableExists(db, 'release_push')).toBe(true);

    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), 'utf-8'));

    expect(tableExists(db, 'release_push')).toBe(false);
    expect(indexNames(db).filter((n) => n.startsWith('idx_release_push_'))).toEqual([]);
    expect(db.prepare('SELECT name FROM spec_release').all()).toEqual([{ name: 'v1' }]);
    db.close();
  });

  it('[entity:remote-session] a fresh database has remote_session with the record\'s columns and unique account index', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expectRemoteSessionAsRecorded(db);
    db.close();
  });

  it('[entity:remote-session] an existing database keeps remote_session as recorded across the drop, its row intact', () => {
    const db = legacyDbBefore059();
    db.prepare(
      `INSERT INTO remote_session (access_token, token_id, issued_at, remote_account_id, account_email, account_status)
       VALUES ('tok', 'tid', '2026-10-01T10:00:00.000Z', 'acc', 'user@example.com', 'active')`,
    ).run();

    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), 'utf-8'));

    expectRemoteSessionAsRecorded(db);
    expect(db.prepare('SELECT remote_account_id, account_status FROM remote_session').all()).toEqual([
      { remote_account_id: 'acc', account_status: 'active' },
    ]);
    db.close();
  });

  it('a fresh database records the migration as applied', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const versions = (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map(
      (r) => r.version,
    );
    expect(versions).toContain('059_drop_release_push');
    db.close();
  });
});

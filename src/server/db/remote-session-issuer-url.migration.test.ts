import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

/**
 * 2.1.58 (M24 `ux690pt2`) — `remote_session.issuer_url`: the effective remote
 * address the token was issued under. Nullable, no default; a row written
 * before the column reads NULL, which means "logged out" — no data step.
 * Checked on both paths a database can take: fresh (the baseline) and upgraded
 * (063 over a row written before it).
 */
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION_FILE = '063_remote_session_issuer_url.sql';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: 0 | 1;
  dflt_value: string | null;
  pk: number;
}

const columns = (db: Database.Database): ColumnInfo[] =>
  db.prepare('PRAGMA table_info(remote_session)').all() as ColumnInfo[];
const column = (db: Database.Database, name: string): ColumnInfo | undefined =>
  columns(db).find((c) => c.name === name);

const uniqueAccountIndex = (db: Database.Database) => {
  const entry = (db.prepare('PRAGMA index_list(remote_session)').all() as Array<{ name: string; unique: 0 | 1 }>).find(
    (i) => i.name === 'uq_remote_session_remote_account_id',
  );
  if (!entry) return undefined;
  const cols = (db.prepare('PRAGMA index_info(uq_remote_session_remote_account_id)').all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  return { unique: entry.unique, columns: cols };
};

/** The schema just before 063: every chain migration up to 062, file by file. */
function dbBefore063(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  for (const file of fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f !== '000_baseline.sql' && f < '063')
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
  }
  return db;
}

describe('remote_session.issuer_url (2.1.58)', () => {
  it('[entity:remote-session] a fresh database has issuer_url as a nullable TEXT column without a default, next to the record\'s other columns and its unique account index', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(column(db, 'issuer_url')).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 });
    expect(columns(db).map((c) => c.name).sort()).toEqual(
      [
        'id',
        'access_token',
        'issuer_url',
        'token_id',
        'issued_at',
        'remote_account_id',
        'account_email',
        'account_status',
        'connected_at',
        'created_at',
        'updated_at',
      ].sort(),
    );
    expect(uniqueAccountIndex(db)).toEqual({ unique: 1, columns: ['remote_account_id'] });
    const versions = (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map(
      (r) => r.version,
    );
    expect(versions).toContain('063_remote_session_issuer_url');
    db.close();
  });

  it('[entity:remote-session] migration 063 adds issuer_url to an existing table; a session written before it reads issuer_url = NULL (logged out), the rest of the row intact', () => {
    const db = dbBefore063();
    expect(column(db, 'issuer_url')).toBeUndefined();
    db.prepare(
      `INSERT INTO remote_session (access_token, token_id, issued_at, remote_account_id, account_email, account_status)
       VALUES ('ciphertext', 'tid-1', '2026-10-01T10:00:00Z', 'acc-1', 'ada@example.com', 'active')`,
    ).run();

    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf-8'));

    expect(column(db, 'issuer_url')).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 });
    expect(db.prepare('SELECT * FROM remote_session').get()).toMatchObject({
      access_token: 'ciphertext',
      issuer_url: null,
      token_id: 'tid-1',
      remote_account_id: 'acc-1',
      account_email: 'ada@example.com',
      account_status: 'active',
    });
    expect(uniqueAccountIndex(db)).toEqual({ unique: 1, columns: ['remote_account_id'] });
    db.close();
  });
});

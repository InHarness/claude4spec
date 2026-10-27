import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { decrypt } from '../services/agent-credential-crypto.js';

/**
 * 2.1.57 (M24 yuhlv2qw, m24-requires-m05) — `remote_session.access_token` is
 * stored encrypted with the M05 secrets primitive. The schema keeps the
 * record's shape; migration 062 is a one-off data step that encrypts the rows
 * written as plaintext before it. Checked on both paths a database can take:
 * fresh (the baseline seeds 062 as applied) and upgraded (062 over a plaintext row).
 */
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const VERSION = '062_remote_session_encrypt_access_token';

// The keyring (`secret.key`) lives under `C4S_HOME` — a throwaway home, never the real one.
let tmpHome: string;
const prevHome = process.env.C4S_HOME;
beforeAll(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-remote-session-'));
  process.env.C4S_HOME = tmpHome;
});
afterAll(() => {
  if (prevHome === undefined) delete process.env.C4S_HOME;
  else process.env.C4S_HOME = prevHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

interface ColumnInfo {
  name: string;
  type: string;
  notnull: 0 | 1;
  dflt_value: string | null;
  pk: number;
}

const accessTokenColumn = (db: Database.Database): ColumnInfo | undefined =>
  (db.prepare('PRAGMA table_info(remote_session)').all() as ColumnInfo[]).find((c) => c.name === 'access_token');

const versions = (db: Database.Database): string[] =>
  (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map((r) => r.version);

/**
 * A legacy install just before 062: the chain replayed up to 061 and recorded in
 * the ledger, so the next `runMigrations` applies 062 alone.
 */
function dbBefore062(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.pragma('foreign_keys = OFF');
  const record = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
  for (const file of fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f !== '000_baseline.sql' && f < '062')
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
    record.run(file.replace(/\.sql$/, ''));
  }
  db.pragma('foreign_keys = ON');
  return db;
}

describe('remote_session.access_token encrypted at-rest (2.1.57)', () => {
  it('[entity:remote-session] a fresh database keeps access_token as TEXT NOT NULL without a default and records 062 as applied', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(accessTokenColumn(db)).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 });
    expect(versions(db)).toContain(VERSION);
    db.close();
  });

  it('[entity:remote-session] migration 062 encrypts a row written as plaintext with the M05 primitive, leaving the rest of the row intact', () => {
    const db = dbBefore062();
    db.prepare(
      `INSERT INTO remote_session (access_token, token_id, issued_at, remote_account_id, account_email, account_status)
       VALUES ('tok-plain', 'tid-1', '2026-10-01T10:00:00Z', 'acc-1', 'ada@example.com', 'active')`,
    ).run();

    expect(runMigrations(db)).toContain(VERSION);

    const row = db.prepare('SELECT * FROM remote_session').get() as Record<string, string>;
    expect(row.access_token).not.toBe('tok-plain');
    expect(row.access_token).not.toContain('tok-plain');
    expect(decrypt(row.access_token)).toBe('tok-plain');
    expect(row).toMatchObject({
      token_id: 'tid-1',
      issued_at: '2026-10-01T10:00:00Z',
      remote_account_id: 'acc-1',
      account_email: 'ada@example.com',
      account_status: 'active',
    });
    expect(accessTokenColumn(db)).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 });
    expect(versions(db)).toContain(VERSION);
    db.close();
  });

  it('[entity:remote-session] the migration runs once — a second start leaves the encrypted token as it is', () => {
    const db = dbBefore062();
    db.prepare(
      `INSERT INTO remote_session (access_token, token_id, issued_at, remote_account_id, account_email, account_status)
       VALUES ('tok-plain', 'tid-1', '2026-10-01T10:00:00Z', 'acc-1', 'ada@example.com', 'active')`,
    ).run();
    runMigrations(db);
    const once = (db.prepare('SELECT access_token FROM remote_session').get() as { access_token: string }).access_token;

    expect(runMigrations(db)).toEqual([]);

    const twice = (db.prepare('SELECT access_token FROM remote_session').get() as { access_token: string }).access_token;
    expect(twice).toBe(once);
    expect(decrypt(twice)).toBe('tok-plain');
    db.close();
  });

  it('[entity:remote-session] an install without a session migrates without writing anything', () => {
    const db = dbBefore062();
    expect(runMigrations(db)).toContain(VERSION);
    expect(db.prepare('SELECT COUNT(*) AS n FROM remote_session').get()).toEqual({ n: 0 });
    db.close();
  });
});

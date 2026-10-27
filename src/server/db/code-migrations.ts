import type Database from 'better-sqlite3';
import { encrypt } from '../services/agent-credential-crypto.js';

/**
 * Data steps a migration cannot express in SQL, keyed by the version (file name
 * without `.sql`) of the migration they belong to. `runMigrations` runs a step
 * right after its SQL file, inside the same batch transaction, so a step that
 * throws rolls the version back with the rest of the batch and the ledger never
 * records a half-migrated database. A fresh database seeds the chain as applied
 * without running it, so no step runs there.
 */
export const CODE_MIGRATIONS: Readonly<Record<string, (db: Database.Database) => void>> = {
  '062_remote_session_encrypt_access_token': encryptRemoteSessionTokens,
};

/**
 * 2.1.57 (M24 yuhlv2qw) — one-off: encrypt the `remote_session` tokens written
 * as plaintext before at-rest encryption. Every row present when this version
 * runs predates it, so every row is plaintext.
 */
function encryptRemoteSessionTokens(db: Database.Database): void {
  const rows = db.prepare('SELECT id, access_token FROM remote_session').all() as Array<{
    id: number;
    access_token: string;
  }>;
  if (rows.length === 0) return;
  const update = db.prepare(
    `UPDATE remote_session SET access_token = ?, updated_at = datetime('now') WHERE id = ?`,
  );
  for (const row of rows) update.run(encrypt(row.access_token), row.id);
}

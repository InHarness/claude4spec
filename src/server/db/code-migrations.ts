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
  '064_chat_thread_context_type_no_default': dropChatThreadContextTypeDefault,
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

/**
 * 2.1.88 (M44 / M21 `gll5xhtr`) — rebuild `chat_thread` so `context_type` is
 * `TEXT NOT NULL` without `DEFAULT 'chat'`.
 *
 * Rebuilt from the table's OWN stored definition rather than a fixed column
 * list: a database reaches this version with or without `plan_id` /
 * `last_seen_plan_version` (the boot-time plan cutover drops them), so the only
 * definition that fits every database is the one it already has, minus the
 * default. Foreign keys (`plan_id`, the `parent_thread_id` self-FK) and the
 * indexes are carried over from `sqlite_master`. `runMigrations` runs the batch
 * with `foreign_keys = OFF`, so the DROP does not cascade into `chat_message`
 * and the other child tables.
 */
function dropChatThreadContextTypeDefault(db: Database.Database): void {
  const table = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_thread'`)
    .get() as { sql: string } | undefined;
  if (!table) throw new Error('[064] chat_thread does not exist');
  const withoutDefault = table.sql.replace(
    /(\bcontext_type\s+TEXT\s+NOT\s+NULL)\s+DEFAULT\s+\(?'chat'\)?/i,
    '$1',
  );
  if (withoutDefault === table.sql) {
    if (/\bcontext_type\b[^,]*\bDEFAULT\b/i.test(table.sql)) {
      throw new Error('[064] chat_thread.context_type has an unexpected DEFAULT');
    }
    return; // already without a default
  }
  const createNew = withoutDefault.replace(/^CREATE TABLE\s+("?)chat_thread\1/i, 'CREATE TABLE chat_thread_new');
  if (createNew === withoutDefault) throw new Error('[064] unexpected chat_thread definition');

  const indexes = (
    db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chat_thread' AND sql IS NOT NULL`)
      .all() as Array<{ sql: string }>
  ).map((r) => r.sql);
  const columns = (db.prepare('PRAGMA table_info(chat_thread)').all() as Array<{ name: string }>)
    .map((c) => `"${c.name}"`)
    .join(', ');

  db.exec(createNew);
  db.exec(`INSERT INTO chat_thread_new (${columns}) SELECT ${columns} FROM chat_thread`);
  db.exec('DROP TABLE chat_thread');
  db.exec('ALTER TABLE chat_thread_new RENAME TO chat_thread');
  for (const sql of indexes) db.exec(sql);
}

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { ChatService } from '../services/chat.js';

/**
 * 2.1.88 (M44 / M21 `gll5xhtr`) — `chat_thread.context_type` is `TEXT NOT NULL`
 * WITHOUT a default (the application always writes it), and `chat_thread`
 * gains `consultation INTEGER NOT NULL DEFAULT 0` (the thread's origin).
 * Checked on both paths a database can take: fresh (the baseline) and upgraded
 * (064 over rows written before it) — the latter in both shapes an upgraded
 * table can have (with and without the plan cutover's dropped columns).
 */
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

interface ColumnInfo {
  name: string;
  type: string;
  notnull: 0 | 1;
  dflt_value: string | null;
  pk: number;
}

const columns = (db: Database.Database): ColumnInfo[] =>
  db.prepare('PRAGMA table_info(chat_thread)').all() as ColumnInfo[];
const column = (db: Database.Database, name: string): ColumnInfo | undefined =>
  columns(db).find((c) => c.name === name);
const indexNames = (db: Database.Database): string[] =>
  (db.prepare('PRAGMA index_list(chat_thread)').all() as Array<{ name: string }>)
    .map((i) => i.name)
    .filter((n) => !n.startsWith('sqlite_autoindex'))
    .sort();
const foreignKeys = (db: Database.Database) =>
  (db.prepare('PRAGMA foreign_key_list(chat_thread)').all() as Array<{ table: string; from: string; to: string; on_delete: string }>)
    .map((f) => `${f.from}->${f.table}.${f.to} ${f.on_delete}`)
    .sort();

/** Every column the `chat-thread` record names at 2.1.88. */
const RECORD_COLUMNS = [
  'id',
  'title',
  'last_session_id',
  'last_usage_json',
  'plan_mode',
  'plan_path',
  'context_type',
  'consultation',
  'brief_path',
  'patch_path',
  'parent_thread_id',
  'spawned_by_tool_use_id',
  'initial_system_prompt',
  'initial_architecture_config_json',
  'created_at',
  'updated_at',
];

const chainBefore064 = () =>
  fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f !== '000_baseline.sql' && f < '064')
    .sort();

/** The schema just before 064, with a ledger saying so — `runMigrations` then applies 064 alone. */
function dbBefore064(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  db.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const record = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
  for (const file of chainBefore064()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
    record.run(file.replace(/\.sql$/, ''));
  }
  db.pragma('foreign_keys = ON');
  return db;
}

/** The shape the boot-time plan cutover (pre-2.1.88) left: no `plan_id` / `last_seen_plan_version`. */
function dropPlanColumnsLikeTheCutover(db: Database.Database): void {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE chat_thread_new (
      id                               TEXT PRIMARY KEY NOT NULL,
      title                            TEXT,
      last_session_id                  TEXT,
      created_at                       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                       TEXT NOT NULL DEFAULT (datetime('now')),
      current_todo_items               TEXT,
      plan_mode                        INTEGER NOT NULL DEFAULT 0,
      initial_system_prompt            TEXT,
      last_usage_json                  TEXT,
      last_context_size                INTEGER,
      context_type                     TEXT NOT NULL DEFAULT 'chat',
      brief_path                       TEXT,
      patch_path                       TEXT,
      plan_path                        TEXT,
      initial_architecture_config_json TEXT,
      parent_thread_id                 TEXT REFERENCES chat_thread(id) ON DELETE CASCADE,
      spawned_by_tool_use_id           TEXT
    );
    INSERT INTO chat_thread_new (id, title, context_type, brief_path, patch_path, plan_path, parent_thread_id, spawned_by_tool_use_id, created_at, updated_at)
      SELECT id, title, context_type, brief_path, patch_path, plan_path, parent_thread_id, spawned_by_tool_use_id, created_at, updated_at FROM chat_thread;
    DROP TABLE chat_thread;
    ALTER TABLE chat_thread_new RENAME TO chat_thread;
    CREATE INDEX idx_chat_thread_brief_path ON chat_thread(brief_path) WHERE brief_path IS NOT NULL;
    CREATE INDEX idx_chat_thread_patch_path ON chat_thread(patch_path) WHERE patch_path IS NOT NULL;
    CREATE INDEX idx_chat_thread_plan_path ON chat_thread(plan_path) WHERE plan_path IS NOT NULL;
    CREATE INDEX idx_chat_thread_parent_thread_id ON chat_thread(parent_thread_id) WHERE parent_thread_id IS NOT NULL;
    DROP TABLE IF EXISTS plan_version;
    DROP TABLE IF EXISTS plan;
  `);
  db.pragma('foreign_keys = ON');
}

function seedLegacyRows(db: Database.Database): void {
  db.prepare(`INSERT INTO chat_thread (id, title) VALUES ('t-default', 'relies on the old default')`).run();
  db.prepare(`INSERT INTO chat_thread (id, title, context_type, brief_path) VALUES ('t-brief', 'b', 'brief', 'v1.md')`).run();
  db.prepare(
    `INSERT INTO chat_thread (id, context_type, parent_thread_id, spawned_by_tool_use_id) VALUES ('t-child', 'chat', 't-brief', 'tu-1')`,
  ).run();
  db.prepare(`INSERT INTO chat_message (thread_id, role, content) VALUES ('t-brief', 'user', 'hello')`).run();
}

describe('chat_thread.context_type without default + consultation (2.1.88)', () => {
  it('[entity:chat-thread] a fresh database has context_type as TEXT NOT NULL without a default, and consultation as INTEGER NOT NULL DEFAULT 0, next to every column of the record', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(column(db, 'context_type')).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 });
    expect(column(db, 'consultation')).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0', pk: 0 });
    const names = columns(db).map((c) => c.name);
    for (const name of RECORD_COLUMNS) expect(names).toContain(name);
    // No SQL CHECK on context_type (L1): any value the registry admits is storable.
    const ddl = (db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'chat_thread'`).get() as { sql: string }).sql;
    expect(ddl).not.toMatch(/CHECK/i);
  });

  it('[entity:chat-thread] a row inserted without context_type is rejected — the column has no default to fall back on', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(() => db.prepare(`INSERT INTO chat_thread (id) VALUES ('t1')`).run()).toThrow(/NOT NULL constraint failed: chat_thread\.context_type/);
    db.prepare(`INSERT INTO chat_thread (id, context_type) VALUES ('t2', 'chat')`).run();
    expect(db.prepare(`SELECT consultation FROM chat_thread WHERE id = 't2'`).get()).toEqual({ consultation: 0 });
  });

  it('[entity:chat-thread] upgrading through 064 keeps every row, child row, foreign key and index, drops the default, and reads consultation 0 on existing rows', () => {
    const db = dbBefore064();
    seedLegacyRows(db);
    const fksBefore = foreignKeys(db);
    const indexesBefore = indexNames(db);
    expect(column(db, 'context_type')?.dflt_value).toBe("'chat'");

    expect(runMigrations(db)).toEqual(['064_chat_thread_context_type_no_default']);

    expect(column(db, 'context_type')).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: null });
    expect(column(db, 'consultation')).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });
    expect(foreignKeys(db)).toEqual(fksBefore);
    expect(indexNames(db)).toEqual(indexesBefore);
    expect(
      db.prepare(`SELECT id, context_type, brief_path, parent_thread_id, consultation FROM chat_thread ORDER BY id`).all(),
    ).toEqual([
      { id: 't-brief', context_type: 'brief', brief_path: 'v1.md', parent_thread_id: null, consultation: 0 },
      { id: 't-child', context_type: 'chat', brief_path: null, parent_thread_id: 't-brief', consultation: 0 },
      { id: 't-default', context_type: 'chat', brief_path: null, parent_thread_id: null, consultation: 0 },
    ]);
    // FK-safe rebuild: the child table's rows survived the DROP, and the self-FK still cascades.
    expect(db.prepare(`SELECT COUNT(*) AS n FROM chat_message WHERE thread_id = 't-brief'`).get()).toEqual({ n: 1 });
    db.prepare(`DELETE FROM chat_thread WHERE id = 't-brief'`).run();
    expect(db.prepare(`SELECT id FROM chat_thread ORDER BY id`).all()).toEqual([{ id: 't-default' }]);
  });

  it('[entity:chat-thread] upgrading a table the plan cutover already narrowed keeps its own column set and drops the default', () => {
    const db = dbBefore064();
    dropPlanColumnsLikeTheCutover(db);
    seedLegacyRows(db);
    const before = columns(db).map((c) => c.name);
    expect(before).not.toContain('plan_id');

    runMigrations(db);

    expect(columns(db).map((c) => c.name)).toEqual([...before, 'consultation']);
    expect(column(db, 'context_type')?.dflt_value).toBeNull();
    expect(indexNames(db)).toEqual([
      'idx_chat_thread_brief_path',
      'idx_chat_thread_parent_thread_id',
      'idx_chat_thread_patch_path',
      'idx_chat_thread_plan_path',
    ]);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM chat_thread`).get()).toEqual({ n: 3 });
  });

  it('[entity:chat-thread] the store writes context_type on every created thread, and consultation once at creation: 1 only for a thread founded as a consultation thread', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const chat = new ChatService(db);
    const plain = chat.createThread('plain');
    const brief = chat.createThread('brief', { contextType: 'brief', briefPath: 'v1.md' });
    const askDirect = chat.createThread(null, { contextType: 'ask' });
    const consult = chat.createThread(null, { contextType: 'ask', consultation: true });
    const col = (id: string) => db.prepare(`SELECT context_type, consultation FROM chat_thread WHERE id = ?`).get(id);
    expect(col(plain.id)).toEqual({ context_type: 'chat', consultation: 0 });
    expect(col(brief.id)).toEqual({ context_type: 'brief', consultation: 0 });
    // The same value opened directly is NOT a consultation thread — origin, not value.
    expect(col(askDirect.id)).toEqual({ context_type: 'ask', consultation: 0 });
    expect(col(consult.id)).toEqual({ context_type: 'ask', consultation: 1 });
    expect(plain.contextType).toBe('chat');
    expect(chat.isConsultationThread(plain.id)).toBe(false);
    expect(chat.isConsultationThread(askDirect.id)).toBe(false);
    expect(chat.isConsultationThread(consult.id)).toBe(true);
    expect(chat.isConsultationThread('missing')).toBe(false);
  });
});

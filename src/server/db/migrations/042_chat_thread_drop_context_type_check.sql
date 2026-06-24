-- M05/0.1.79 'ask' context_type — older published versions rebuilt chat_thread
-- in migration 029 WITH `CHECK (context_type IN ('chat','brief','patch'))`.
-- SQLite cannot ALTER/DROP a CHECK and 029 is already recorded as applied, so
-- DBs created by those versions still reject 'ask'. Rebuild the table once more
-- with NO context_type CHECK (validation lives in CONTEXT_TYPE_REGISTRY,
-- chat-context.ts). Idempotent: a rebuild is harmless for DBs already lacking
-- the constraint. FK-safe — migrate.ts disables foreign_keys around the batch,
-- so the DROP does not cascade-delete chat_message / chat_subagent_task /
-- chat_queued_message rows, and the self-FK parent_thread_id re-resolves once
-- the new table is renamed in.
-- Full column set as of migrations 005/009/010/011/013/021/024/022/029/033/041.

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
  plan_id                          INTEGER REFERENCES plan(id) ON DELETE SET NULL,
  last_seen_plan_version           INTEGER,
  last_context_size                INTEGER,
  context_type                     TEXT NOT NULL DEFAULT 'chat',
  brief_path                       TEXT,
  patch_path                       TEXT,
  initial_architecture_config_json TEXT,
  parent_thread_id                 TEXT REFERENCES chat_thread(id) ON DELETE CASCADE,
  spawned_by_tool_use_id           TEXT
);

INSERT INTO chat_thread_new (
  id, title, last_session_id, created_at, updated_at, current_todo_items,
  plan_mode, initial_system_prompt, last_usage_json, plan_id,
  last_seen_plan_version, last_context_size, context_type, brief_path,
  patch_path, initial_architecture_config_json, parent_thread_id,
  spawned_by_tool_use_id
)
SELECT
  id, title, last_session_id, created_at, updated_at, current_todo_items,
  plan_mode, initial_system_prompt, last_usage_json, plan_id,
  last_seen_plan_version, last_context_size, context_type, brief_path,
  patch_path, initial_architecture_config_json, parent_thread_id,
  spawned_by_tool_use_id
FROM chat_thread;

DROP TABLE chat_thread;

ALTER TABLE chat_thread_new RENAME TO chat_thread;

CREATE INDEX idx_chat_thread_plan ON chat_thread(plan_id);

CREATE INDEX IF NOT EXISTS idx_chat_thread_brief_path
  ON chat_thread(brief_path) WHERE brief_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_thread_patch_path
  ON chat_thread(patch_path) WHERE patch_path IS NOT NULL;

CREATE INDEX idx_chat_thread_parent_thread_id ON chat_thread(parent_thread_id);

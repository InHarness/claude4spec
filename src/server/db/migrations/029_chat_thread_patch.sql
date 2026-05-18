-- M23 Patches (v0.1.23) — chat_thread gains a third context_type ('patch') and
-- a `patch_path` pointer. Migration 022 added `context_type` with
-- `CHECK (context_type IN ('chat','brief'))`; SQLite cannot ALTER a CHECK, so
-- the table is rebuilt. Per the v0.1.23 brief the rebuilt column carries NO
-- CHECK at all — `context_type` is a plain TEXT column whose allowed values
-- ('chat'|'brief'|'patch', and any future value) are validated in application
-- code by the contextTypeRegistry in chat-context.ts. Adding a future
-- context_type therefore needs no migration.
-- Spec: db/db-m05-chat.md, modules/m23-patches.md.
--
-- chat_thread has INCOMING foreign keys: chat_message.thread_id (ON DELETE
-- CASCADE) and plan.accepted_thread_id (ON DELETE SET NULL). The SQLite
-- table-rebuild procedure is followed: create the new table under a temp
-- name, copy, DROP the original, then RENAME the new one into place. The
-- migration runner disables `foreign_keys` around the batch, so the DROP does
-- NOT cascade-delete chat_message rows; the child FK clauses keep referencing
-- the name `chat_thread` and resolve again once the new table is renamed in.

-- Full column set as of migrations 005/009/010/011/013/021/024/022, plus the
-- new patch_path. Only changes vs. the old schema: the context_type CHECK is
-- dropped (validation moves to application code), and patch_path is appended.
CREATE TABLE chat_thread_new (
  id                     TEXT PRIMARY KEY NOT NULL,
  title                  TEXT,
  last_session_id        TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  current_todo_items     TEXT,
  plan_mode              INTEGER NOT NULL DEFAULT 0,
  initial_system_prompt  TEXT,
  last_usage_json        TEXT,
  plan_id                INTEGER REFERENCES plan(id) ON DELETE SET NULL,
  last_seen_plan_version INTEGER,
  last_context_size      INTEGER,
  context_type           TEXT NOT NULL DEFAULT 'chat',
  brief_path             TEXT,
  patch_path             TEXT
);

INSERT INTO chat_thread_new (
  id, title, last_session_id, created_at, updated_at, current_todo_items,
  plan_mode, initial_system_prompt, last_usage_json, plan_id,
  last_seen_plan_version, last_context_size, context_type, brief_path
)
SELECT
  id, title, last_session_id, created_at, updated_at, current_todo_items,
  plan_mode, initial_system_prompt, last_usage_json, plan_id,
  last_seen_plan_version, last_context_size, context_type, brief_path
FROM chat_thread;

DROP TABLE chat_thread;

ALTER TABLE chat_thread_new RENAME TO chat_thread;

CREATE INDEX idx_chat_thread_plan ON chat_thread(plan_id);

-- Partial index for "open threads for this brief" — same as migration 022.
CREATE INDEX IF NOT EXISTS idx_chat_thread_brief_path
  ON chat_thread(brief_path) WHERE brief_path IS NOT NULL;

-- Partial index for "open threads for this patch" (GET /api/patches/:path
-- threadCount + POST /api/patches/:path/threads lookups).
CREATE INDEX IF NOT EXISTS idx_chat_thread_patch_path
  ON chat_thread(patch_path) WHERE patch_path IS NOT NULL;

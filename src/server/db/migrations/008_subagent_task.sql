-- M05 extension: subagent task persistence (reconstruction po reload).
-- Spec: .claude/skills/specyfikacja/db/db-m05-chat.md

ALTER TABLE chat_message ADD COLUMN subagent_task_id TEXT;

CREATE INDEX idx_cm_subagent_task ON chat_message(subagent_task_id);

CREATE TABLE chat_subagent_task (
  thread_id TEXT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  tool_use_id TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (thread_id, task_id)
);

CREATE INDEX idx_cst_thread ON chat_subagent_task(thread_id);

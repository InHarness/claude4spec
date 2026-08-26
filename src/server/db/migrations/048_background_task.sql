-- M05: engine-backgrounded task persistence (reconstruction po reload).
-- Sibling table to chat_subagent_task — a backgrounded shell/monitor/workflow
-- is NOT a subagent (agent-adapters 0.9.1 background_task_* event family).

CREATE TABLE chat_background_task (
  thread_id TEXT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  output_file TEXT,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (thread_id, task_id)
);

CREATE INDEX idx_cbt_thread ON chat_background_task(thread_id);

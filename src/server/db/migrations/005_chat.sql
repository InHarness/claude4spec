-- Etap 4: M05 chat & agent — thread persistence.
-- Spec: .claude/skills/specyfikacja/db/db-m05-chat.md

CREATE TABLE chat_thread (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT,
  last_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE chat_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cm_thread ON chat_message(thread_id);
CREATE INDEX idx_cm_tool ON chat_message(tool_id);

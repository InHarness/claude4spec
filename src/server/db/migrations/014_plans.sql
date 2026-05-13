-- Etap: M10 Plans — plan wdrozenia jako artefakt chatu.
-- Spec: .claude/skills/specyfikacja/db/db-m10-plans.md

CREATE TABLE plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL UNIQUE REFERENCES chat_thread(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  current_version INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  accepted_at TEXT,
  accepted_mode TEXT,
  accepted_thread_id TEXT REFERENCES chat_thread(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_plan_thread ON plan(thread_id);
CREATE INDEX idx_plan_status ON plan(status);

CREATE TABLE plan_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  action TEXT NOT NULL,
  action_params TEXT,
  change_summary TEXT,
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pv_plan ON plan_version(plan_id);
CREATE UNIQUE INDEX uq_pv_plan_version ON plan_version(plan_id, version);

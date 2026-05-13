-- Etap: M10 — przejscie z 1:1 (plan.thread_id UNIQUE) na N:1 (chat_thread.plan_id).
-- Spec: .claude/skills/specyfikacja/db/db-m10-plans.md, db/db-m05-chat.md (sekcja planrefn1).
--
-- Strategia: table-recreate dla `plan` (drop kolumny thread_id + dodanie title) z deferred FK,
-- bo `chat_thread.plan_id` (nowa kolumna) trzyma FK na `plan.id`.

PRAGMA defer_foreign_keys = ON;

-- 1) Nowe kolumny w chat_thread.
ALTER TABLE chat_thread ADD COLUMN plan_id INTEGER REFERENCES plan(id) ON DELETE SET NULL;
ALTER TABLE chat_thread ADD COLUMN last_seen_plan_version INTEGER;

-- 2) Backfill ze starej kolumny plan.thread_id (1:1) na chat_thread.plan_id.
UPDATE chat_thread
   SET plan_id = (SELECT id FROM plan WHERE plan.thread_id = chat_thread.id),
       last_seen_plan_version = (SELECT current_version FROM plan WHERE plan.thread_id = chat_thread.id);

-- 3) Recreate `plan` bez thread_id, z opcjonalnym title.
--    Kolumna title jest NULL po INSERT — fixup w kodzie wyciaga pierwszy `# Heading` z content.
CREATE TABLE plan_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO plan_new (id, content, current_version, created_at, updated_at)
  SELECT id, content, current_version, created_at, updated_at FROM plan;

DROP TABLE plan;
ALTER TABLE plan_new RENAME TO plan;

-- 4) Indeks dla "Otworz ostatni watek tego planu" + threadCount per plan.
CREATE INDEX idx_chat_thread_plan ON chat_thread(plan_id);

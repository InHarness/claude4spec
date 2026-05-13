-- Etap: M05 chat — plan mode per thread + per-message snapshot.
-- Spec: .claude/skills/specyfikacja/db/db-m05-chat.md

ALTER TABLE chat_thread ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_message ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0;

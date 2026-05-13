-- Etap: M05 chat — snapshot pierwszego system promptu na thread (debug/audyt).
-- Spec: .claude/skills/specyfikacja/db/db-m05-chat.md (sekcja "System prompt snapshot")

ALTER TABLE chat_thread ADD COLUMN initial_system_prompt TEXT;

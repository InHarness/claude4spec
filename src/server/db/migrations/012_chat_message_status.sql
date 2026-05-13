-- Etap: M05 chat — lifecycle wiersza chat_message (streaming vs complete).
-- Uzywane do wykrycia orphan tool_use po crashu serwera i auto-resume po F5.
-- Spec: .claude/skills/specyfikacja/db/db-m05-chat.md (sekcja "Planowane: kolumna chat_message.status")

ALTER TABLE chat_message ADD COLUMN status TEXT NOT NULL DEFAULT 'complete';

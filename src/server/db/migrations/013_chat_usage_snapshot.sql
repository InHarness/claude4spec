-- Etap: M05 chat — snapshot zuzycia tokenow (thread-level + per-turn).
-- Thread-level: szybka hydracja <UsageBadge /> przy loadThread (bez tego badge pokazuje "—" do nastepnego result).
-- Per-turn: historia wzrostu kontekstu per tura (debug/wykres).
-- Spec: .claude/skills/specyfikacja/db/db-m05-chat.md (sekcja "Usage snapshot")

ALTER TABLE chat_thread  ADD COLUMN last_usage_json TEXT;
ALTER TABLE chat_message ADD COLUMN usage_json TEXT;

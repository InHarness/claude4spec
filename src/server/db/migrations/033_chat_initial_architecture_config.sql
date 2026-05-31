-- Etap: M05 chat — snapshot { model, architectureConfig } z pierwszej tury (debug/audyt).
-- Punkt odniesienia dla guarda RESUME_CONFIG_LOCKED (model + pola reasoningu sa
-- session-immutable). Analogiczne do initial_system_prompt — debug-only, poza domyslna
-- projekcja GET /api/threads/:id.
-- Spec: .claude/skills/specyfikacja/db/db-m05-chat.md

ALTER TABLE chat_thread ADD COLUMN initial_architecture_config_json TEXT;

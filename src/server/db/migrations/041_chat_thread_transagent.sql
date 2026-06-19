-- 0.1.69 Transagents ("bańki") — a chat/patch thread can delegate a unit of
-- work to a hidden CHILD thread of the same spec. The child runs a full turn,
-- streams live into the parent's panel, and returns only a `summary` to the
-- parent LLM's context.
--
-- chat_thread gains a self-referential parent pointer (NULL = top-level thread,
-- NOT NULL = child banka) plus the parent tool_use id that spawned it (used for
-- F5 reconstruction: resolve childThreadId from the stored tool_use row via
-- (parent_thread_id, spawned_by_tool_use_id)).
--
-- Migration 029 rebuilt chat_thread without a context_type CHECK; here we only
-- ADD COLUMN, so no table rebuild is needed. The self-FK on parent_thread_id is
-- safe under ALTER TABLE ADD COLUMN — the migration runner disables foreign_keys
-- around the batch (see migrate.ts), so this neither rebuilds nor cascade-checks
-- existing rows.
-- Spec: 0.1.69 brief — Transagents.

ALTER TABLE chat_thread ADD COLUMN parent_thread_id TEXT
  REFERENCES chat_thread(id) ON DELETE CASCADE;   -- NULL = top-level; NOT NULL = child banka
ALTER TABLE chat_thread ADD COLUMN spawned_by_tool_use_id TEXT;

CREATE INDEX idx_chat_thread_parent_thread_id ON chat_thread(parent_thread_id);

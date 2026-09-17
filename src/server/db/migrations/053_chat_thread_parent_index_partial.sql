-- 0.2.87 (M46): `idx_chat_thread_parent_thread_id` becomes a PARTIAL index.
--
-- Top-level threads are the overwhelming majority and carry parent_thread_id = NULL;
-- only transagent children ("bańki") are worth indexing. Same shape as the sibling
-- artifact-anchor indexes (brief_path / patch_path / plan_path), which were already
-- partial. No data change, no table rebuild.

DROP INDEX IF EXISTS idx_chat_thread_parent_thread_id;
CREATE INDEX idx_chat_thread_parent_thread_id ON chat_thread(parent_thread_id)
  WHERE parent_thread_id IS NOT NULL;

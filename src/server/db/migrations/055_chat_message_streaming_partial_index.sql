-- 2.1.x: partial index for the boot sweep `finalizeAllStreamingRows()`.
--
-- `UPDATE chat_message SET status = 'complete' WHERE status = 'streaming'` runs on
-- every ProjectContext build and had no index to use: a full scan of chat_message,
-- whose rows carry the large `content` column, so SQLite walks the overflow pages
-- of every row. On a long-lived project (265k rows / ~700 MB) that is several
-- seconds of synchronous better-sqlite3 work — the whole event loop stalls for it.
--
-- `streaming` rows exist only while a turn is in flight, so the partial index is
-- empty almost always and costs nothing on the write path. No data change.

CREATE INDEX IF NOT EXISTS idx_cm_streaming ON chat_message(status) WHERE status = 'streaming';

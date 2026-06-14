-- v0.1.60 — M05 chat message queue (composer stays unlocked during a live turn).
-- A row exists from enqueue until delivery (mid-turn push or after-turn merged
-- dispatch) or cancellation, then it is deleted and (on delivery) a `chat_message`
-- (role 'user') takes its place. Persistence is the single source of truth for
-- multiple live-join clients of a thread and survives a server crash / F5.
-- Hard limit: 20 rows per thread (enforced in the service layer → 400 QUEUE_FULL).
-- thread_id is the nanoid TEXT PK of chat_thread; ON DELETE CASCADE drops the queue.

CREATE TABLE chat_queued_message (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id        TEXT    NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,            -- monotonic per-thread order
  prompt           TEXT    NOT NULL,            -- markdown with serialized PageRefNode (same as POST /api/chat body)
  annotations_json TEXT,                        -- annotations snapshot at enqueue (shape: annotations field of POST /api/chat)
  current_page     TEXT,                        -- current page context at enqueue (path), NULL when absent
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chat_queued_message_thread_pos ON chat_queued_message (thread_id, position);

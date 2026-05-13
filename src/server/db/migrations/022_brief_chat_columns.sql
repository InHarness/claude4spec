-- M21 Briefs: generic context discriminator + brief file pointer on chat_thread.
-- Spec: db/db-m05-chat.md (sekcja m21chatcols), modules/m21-briefs.md, modules/m05-chat-agent.md (sekcja m05ctxreg).
--
-- context_type: 'chat' (default) | 'brief'. Determines system prompt skill,
-- MCP tools whitelist (routes/chat.ts) i UI chrome (overlay vs brief-detail).
-- Forward-compat: trzeci typ wymaga CHECK migration + registry entry.
--
-- brief_path: relative path to brief file under briefsDir (np. v0-3-to-v0-4.md).
-- Brak FK bo brief zyje na FS (plik moze byc usuniety/przeniesiony przez usera).
-- Invariant L2: context_type='brief' ⇒ brief_path IS NOT NULL ∧ plik istnieje
-- przy tworzeniu watku (egzekwowane w warstwie aplikacji, nie w DB).

ALTER TABLE chat_thread
  ADD COLUMN context_type TEXT NOT NULL DEFAULT 'chat'
  CHECK (context_type IN ('chat','brief'));

ALTER TABLE chat_thread
  ADD COLUMN brief_path TEXT;

-- Indeks pod query "open threads for this brief" (GET /api/briefs/:path/threads)
-- oraz threadCount na liscie /briefs. Partial index — pomija watki 'chat'.
CREATE INDEX IF NOT EXISTS idx_chat_thread_brief_path
  ON chat_thread(brief_path) WHERE brief_path IS NOT NULL;

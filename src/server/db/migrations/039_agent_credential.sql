-- v0.1.62 — M05 chat-agent: user-supplied ANTHROPIC API key (own key instead of
-- the local Claude Code login). Single-row store (like remote_session): write =
-- upsert (delete-then-insert), clear = delete — enforced in the L2 service, not by
-- a SQL constraint. The key is encrypted at-rest (AES-256-GCM); plaintext never
-- lives in this table. `key_last4` is the last 4 chars of the plaintext, kept only
-- for the masked preview (sk-ant-…••••<last4>) — not a secret. `provider` is an
-- enum {'anthropic'} validated in application code (no SQL CHECK by convention).

CREATE TABLE agent_credential (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  provider           TEXT NOT NULL DEFAULT 'anthropic',
  api_key_ciphertext TEXT NOT NULL,   -- AES-256-GCM, base64 "iv|authTag|ciphertext"
  key_last4          TEXT NOT NULL,   -- last 4 chars of plaintext, for masked preview only
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_agent_credential_provider ON agent_credential (provider);

-- M24 Remote Account (v0.1.27) — local cache of the remote-API identity obtained
-- via OAuth 2.0 Device Authorization Grant (RFC 8628). The remote server is the
-- identity provider; c4s stays local + single-user. This is a single-row store:
-- login is an atomic DELETE + INSERT in one transaction, logout is a DELETE.
--
-- access_token is an opaque Bearer injected into outbound calls — it is NEVER
-- logged and NEVER returned by GET /api/remote-account. account_status is an
-- enum ('active'|'deactivated') validated in application code (L1 convention —
-- no CHECK). connected_at is a local timestamp (independent of the remote-side
-- issued_at) used for "connected N days ago" in the UI.
-- Spec: db/db-m24-remote-session.md, modules/m24-remote-account.md.

CREATE TABLE remote_session (
  id                INTEGER PRIMARY KEY,
  access_token      TEXT NOT NULL,
  token_id          TEXT NOT NULL,
  issued_at         TEXT NOT NULL,
  remote_account_id TEXT NOT NULL,
  account_email     TEXT NOT NULL,
  account_status    TEXT NOT NULL,
  connected_at      TEXT NOT NULL DEFAULT (datetime('now')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Safety net at the schema level plus L2 discipline (single-row store, but the
-- surrogate PK keeps the L1 convention).
CREATE UNIQUE INDEX uq_remote_session_remote_account_id
  ON remote_session(remote_account_id);

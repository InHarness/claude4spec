-- M27 Project Clone (v0.1.35) — append-only audit log of every `--clone` attempt
-- (success OR error); one row per completed clone. In-progress clones are never
-- persisted. Reverse-direction peer of release_push (M25): push sends local →
-- remote, clone pulls remote → local. Correlates the new local release #1 to the
-- remote release via local_release_id ↔ remote_release_id.
--
-- INSERT-only (no UPDATE/DELETE). status is an enum ('success'|'error') validated
-- in application code (no SQL CHECK, matching release_push.status). The earlier a
-- clone fails, the more columns are NULL — readers must tolerate NULL on every
-- column except remote_project_slug, status, and imported_at. imported_by_account_*
-- are NULL for the anonymous v1 clone (forward-compat for a v2 bearer-authed draft
-- clone). FK local_release_id → spec_release(id) is nullable, no ON DELETE.
-- Spec: brief 0-1-34-to-0-1-35.md (M27 Project Clone).

CREATE TABLE release_import (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  local_release_id          INTEGER REFERENCES spec_release(id),  -- nullable, no ON DELETE
  remote_project_id         TEXT,                                 -- ← X-Project-Id
  remote_project_slug       TEXT    NOT NULL,                     -- user input, always known
  remote_release_id         TEXT,                                 -- ← X-Release-Id
  remote_release_sequence   INTEGER,                              -- ← X-Release-Sequence
  content_sha256            TEXT,                                 -- ← X-Content-SHA256
  content_size_bytes        INTEGER,                              -- ← Content-Length
  bundle_schema_version     INTEGER,                              -- ← bundle manifest (NOT a header)
  imported_by_account_id    TEXT,                                 -- NULL for anon v1 clone
  imported_by_account_email TEXT,                                 -- NULL for anon v1 clone
  status                    TEXT    NOT NULL,                     -- 'success' | 'error' (app-validated, no SQL CHECK)
  error_message             TEXT,                                 -- only when status='error'
  imported_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_release_import_local_release ON release_import(local_release_id);

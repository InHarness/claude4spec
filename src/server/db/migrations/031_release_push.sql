-- M25 Release Push (v0.1.29) — append-only audit log of every push attempt to
-- the remote claude4spec-API. Each completed POST /api/release-pushes (success
-- OR error) writes one row; in-progress attempts are never persisted. Retry =
-- a new INSERT; there is no UPDATE and no DELETE.
--
-- Separate table (not an extension of spec_release): spec_release is the local
-- release axis (immutable beyond MAX(id)); release_push is the transport audit —
-- many rows per release (retries, dedup hits, error rows).
--
-- No FK to remote_session: the session is a single mutable row wiped on logout,
-- but historical pushes must survive logout. Identity is therefore SNAPSHOTTED
-- into pushed_by_account_* at push time (no FK). pushed_by_account_id is a remote
-- UUID (AccountProfileResponse.id), not a local entity. status is an enum
-- ('success'|'error') validated in application code (L1 convention — no CHECK).
-- Spec: brief 0-1-28-to-0-1-29.md (M25), modules/m25-release-push.md.

CREATE TABLE release_push (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id               INTEGER NOT NULL REFERENCES spec_release(id),
  remote_project_id        TEXT    NOT NULL,                -- UUID of the project on the remote
  remote_release_id        TEXT,                            -- UUID of the release on the remote; NULL on error
  remote_release_sequence  INTEGER,                         -- per-project sequence; NULL on error
  content_sha256           TEXT    NOT NULL,                -- lowercase hex64; from M17.buildBundleArchive
  content_size_bytes       INTEGER NOT NULL,                -- from M17.buildBundleArchive
  deduplicated             INTEGER NOT NULL DEFAULT 0,      -- 0 or 1; the peer dedups by SHA
  pushed_by_account_id     TEXT    NOT NULL,                -- snapshot of remote_session.remote_account_id
  pushed_by_account_email  TEXT,                            -- snapshot of remote_session.account_email (cached identity)
  bundle_schema_version    INTEGER NOT NULL,                -- from M17.buildBundleArchive
  status                   TEXT    NOT NULL,                -- 'success' | 'error'; validated in app (no SQL CHECK)
  error_message            TEXT,                            -- populated only for status='error'
  pushed_at                TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_release_push_release_id        ON release_push (release_id, pushed_at DESC);
-- NON-UNIQUE: a deduplicated push (deduplicated=1) legitimately points at the
-- same remote_release_id as its predecessor — UNIQUE would be too strong.
CREATE INDEX idx_release_push_remote_release_id ON release_push (remote_release_id);

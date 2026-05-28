-- M25 Release Push (v0.1.32) — relax NOT NULL on release_push.remote_project_id.
--
-- Why: a first-push error (network / 5xx before the peer returned the project
-- UUID) leaves config.remoteProjectId still null AND the peer never produced an
-- id to record. Pre-0.1.32 the column was NOT NULL so such a row was either
-- impossible to persist or persisted with the empty-string sentinel `''`.
-- Subsequent-push error rows still carry the known config.remoteProjectId; the
-- nullable column applies only to the first-push error case.
--
-- SQLite has no ALTER COLUMN DROP NOT NULL, so we rebuild the table. The
-- migration runner already toggles PRAGMA foreign_keys around the batch and
-- wraps this file in its own transaction — no BEGIN/COMMIT/PRAGMA here.
--
-- AUTOINCREMENT note: dropping the old table evicts its sqlite_sequence row,
-- which would reset the high-water mark and risk colliding ids if a row were
-- ever deleted. We preserve the seq explicitly before the drop.

ALTER TABLE release_push RENAME TO release_push__old;

CREATE TABLE release_push (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id               INTEGER NOT NULL REFERENCES spec_release(id),
  remote_project_id        TEXT,                            -- UUID; NULL only for first-push error rows
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

INSERT INTO release_push
  (id, release_id, remote_project_id, remote_release_id, remote_release_sequence,
   content_sha256, content_size_bytes, deduplicated, pushed_by_account_id,
   pushed_by_account_email, bundle_schema_version, status, error_message,
   pushed_at, created_at, updated_at)
SELECT
  id, release_id, remote_project_id, remote_release_id, remote_release_sequence,
  content_sha256, content_size_bytes, deduplicated, pushed_by_account_id,
  pushed_by_account_email, bundle_schema_version, status, error_message,
  pushed_at, created_at, updated_at
FROM release_push__old;

-- Preserve AUTOINCREMENT high-water mark across the rebuild.
INSERT OR REPLACE INTO sqlite_sequence (name, seq)
  SELECT 'release_push', seq FROM sqlite_sequence WHERE name = 'release_push__old';
DELETE FROM sqlite_sequence WHERE name = 'release_push__old';

DROP TABLE release_push__old;

CREATE INDEX idx_release_push_release_id        ON release_push (release_id, pushed_at DESC);
-- NON-UNIQUE: a deduplicated push (deduplicated=1) legitimately points at the
-- same remote_release_id as its predecessor — UNIQUE would be too strong.
CREATE INDEX idx_release_push_remote_release_id ON release_push (remote_release_id);

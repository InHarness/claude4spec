-- 0.1.96 multiroot — re-key page_version from `kind` to a dynamic `rootId`.
-- A page is now identified by `(rootId, path)` where `rootId` is the built-in
-- 'pages' root, a user-defined root slug, or one of the fixed markers
-- 'brief'/'patch'. `rootId` is DYNAMIC — no CHECK constraint, no replacement enum
-- (unlike the legacy `kind` which had none since 028 anyway).
--
-- Follows the 028 rebuild pattern (rename → create → copy → drop → recreate
-- indexes). The runner (migrate.ts) toggles PRAGMA foreign_keys OFF around the
-- batch. page_version has no incoming FKs (release_id is a loose app-layer ref),
-- so a plain rename/create/copy/drop is safe.
--
-- Column rename `kind` → `rootId` with a value remap: ONLY 'page' → 'pages';
-- 'brief'/'patch' markers are copied verbatim. Legacy `UNIQUE(path, version)` is
-- replaced by `UNIQUE(path, rootId, version)` so the same relative path can exist
-- in multiple roots. `idx_page_version_kind_release` becomes (rootId, release_id).

ALTER TABLE page_version RENAME TO page_version_old;

CREATE TABLE page_version (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  path                TEXT NOT NULL,
  version             INTEGER NOT NULL,
  data                TEXT NOT NULL,
  serializer_version  TEXT NOT NULL,
  op                  TEXT NOT NULL CHECK (op IN ('create', 'update', 'delete')),
  release_id          INTEGER NULL,
  changed_by          TEXT NOT NULL CHECK (changed_by IN ('user', 'agent', 'filesystem')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  rootId              TEXT NOT NULL DEFAULT 'pages',
  change_summary      TEXT NULL,

  UNIQUE(path, rootId, version)
);

INSERT INTO page_version (
  id, path, version, data, serializer_version, op, release_id, changed_by,
  created_at, rootId, change_summary
)
SELECT
  id, path, version, data, serializer_version, op, release_id, changed_by,
  created_at,
  CASE kind WHEN 'page' THEN 'pages' ELSE kind END,
  change_summary
FROM page_version_old;

DROP TABLE page_version_old;

CREATE INDEX idx_page_version_release        ON page_version(release_id);
CREATE INDEX idx_page_version_path           ON page_version(path);
CREATE INDEX idx_page_version_root_release   ON page_version(rootId, release_id);

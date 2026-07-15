-- 0.1.126 M36: rename page_version -> file_version (generic chat-artifact/page
-- versioning module). Same columns, no value remap — this table already keys on
-- `rootId` (see 043_page_version_root_id.sql), so this is purely a table/index
-- rename, naming the previously-unnamed UNIQUE(path, rootId, version) constraint
-- as uq_file_version_path_root_version.
--
-- Follows the established rebuild pattern (rename -> create -> copy -> drop ->
-- recreate indexes). The runner (migrate.ts) toggles PRAGMA foreign_keys OFF
-- around the batch. page_version has no incoming FKs (release_id is a loose
-- app-layer ref), so a plain rename/create/copy/drop is safe.

ALTER TABLE page_version RENAME TO page_version_old;

CREATE TABLE file_version (
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

  CONSTRAINT uq_file_version_path_root_version UNIQUE(path, rootId, version)
);

INSERT INTO file_version (
  id, path, version, data, serializer_version, op, release_id, changed_by,
  created_at, rootId, change_summary
)
SELECT
  id, path, version, data, serializer_version, op, release_id, changed_by,
  created_at, rootId, change_summary
FROM page_version_old;

DROP TABLE page_version_old;

CREATE INDEX idx_file_version_release        ON file_version(release_id);
CREATE INDEX idx_file_version_path           ON file_version(path);
CREATE INDEX idx_file_version_root_release   ON file_version(rootId, release_id);

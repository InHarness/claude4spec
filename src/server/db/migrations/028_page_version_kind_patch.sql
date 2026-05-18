-- M23 Patches (v0.1.22) — relax the `kind` discriminator on page_version so a
-- third source ('patch', patchesDir) can be versioned alongside 'page' and
-- 'brief'. Migration 023 added `kind` with `CHECK (kind IN ('page','brief'))`;
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt. Per the
-- v0.1.22 brief, `kind` carries NO CHECK — allowed values ('page'|'brief'|
-- 'patch') are validated in the application layer.
-- Spec: modules/m23-patches.md, modules/m17-snapshots-releases.md.
--
-- page_version has no incoming foreign keys (release_id is a loose ref,
-- enforced in app layer) — a plain rename/create/copy/drop is safe.

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
  kind                TEXT NOT NULL DEFAULT 'page',
  change_summary      TEXT NULL,

  UNIQUE(path, version)
);

INSERT INTO page_version (
  id, path, version, data, serializer_version, op, release_id, changed_by,
  created_at, kind, change_summary
)
SELECT
  id, path, version, data, serializer_version, op, release_id, changed_by,
  created_at, kind, change_summary
FROM page_version_old;

DROP TABLE page_version_old;

CREATE INDEX idx_page_version_release      ON page_version(release_id);
CREATE INDEX idx_page_version_path         ON page_version(path);
CREATE INDEX idx_page_version_kind_release ON page_version(kind, release_id);

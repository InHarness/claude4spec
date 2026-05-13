-- M17 Spec Snapshots & Releases — Phase 4
-- Append-only versioning for markdown pages (M02 stays out of L9 plugin host;
-- decyzja 1 in M17 plan). Parallel to entity_version but for filesystem pages.

CREATE TABLE page_version (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  path                TEXT NOT NULL,                                                -- "modules/m01-auth.md"
  version             INTEGER NOT NULL,                                             -- 1, 2, 3, ... per path
  data                TEXT NOT NULL,                                                -- JSON: PageSnapshotData
  serializer_version  TEXT NOT NULL,
  op                  TEXT NOT NULL CHECK (op IN ('create', 'update', 'delete')),
  release_id          INTEGER NULL,                                                 -- FK semantics enforced in app layer
  changed_by          TEXT NOT NULL CHECK (changed_by IN ('user', 'agent', 'filesystem')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(path, version)
);

CREATE INDEX idx_page_version_release ON page_version(release_id);
CREATE INDEX idx_page_version_path    ON page_version(path);

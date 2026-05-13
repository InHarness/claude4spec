-- v0.1.13 — Acceptance Criteria entity (M11)
-- AC = first-class entity. Polymorphic entity_tag (001_endpoint.sql) i polymorphic
-- entity_version (017_entity_version_m17.sql) automatycznie obsluguja
-- entity_type='ac' bez dodatkowych zmian.

CREATE TABLE IF NOT EXISTS ac (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  text         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'requirement',
  status       TEXT NOT NULL DEFAULT 'active',
  verifies     TEXT NOT NULL DEFAULT '[]',
  description  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ac_status ON ac(status);
CREATE INDEX IF NOT EXISTS idx_ac_kind   ON ac(kind);

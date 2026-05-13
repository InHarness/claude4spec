-- Etap 2: M03 endpoint + versioning + L6 tags core tables.
-- dto + endpoint_dto tables land with Etap 3 (M04).

CREATE TABLE endpoint (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  description TEXT,
  request_body TEXT,
  response_body TEXT,
  status_codes TEXT,
  module TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_endpoint_module ON endpoint(module);

CREATE TABLE entity_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  change_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, entity_id, version)
);
CREATE INDEX idx_ev_entity ON entity_version(entity_type, entity_id);

CREATE TABLE tag (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE entity_tag (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  UNIQUE(entity_type, entity_id, tag_id)
);
CREATE INDEX idx_entity_tag_tag_id ON entity_tag(tag_id);
CREATE INDEX idx_entity_tag_entity ON entity_tag(entity_type, entity_id);

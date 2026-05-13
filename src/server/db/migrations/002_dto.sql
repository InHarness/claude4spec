-- Etap 3: M04 DTO table + endpoint_dto junction.

CREATE TABLE dto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  fields TEXT NOT NULL DEFAULT '[]',
  module TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_dto_module ON dto(module);

CREATE TABLE endpoint_dto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id INTEGER NOT NULL REFERENCES endpoint(id) ON DELETE CASCADE,
  dto_id INTEGER NOT NULL REFERENCES dto(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  UNIQUE(endpoint_id, dto_id, relation)
);
CREATE INDEX idx_endpoint_dto_endpoint ON endpoint_dto(endpoint_id);
CREATE INDEX idx_endpoint_dto_dto ON endpoint_dto(dto_id);

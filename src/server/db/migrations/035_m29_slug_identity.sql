-- M29 Entity Store — slug becomes the sole identity of entities (decyzja #13).
-- Drop the integer surrogate `id` from all entity tables + `tag`, and convert
-- every polymorphic/junction table that references entities from entity_id
-- (INTEGER) to entity_slug/tag_slug/endpoint_slug/dto_slug (TEXT).
--
-- This migration runs inside migrate.ts's FK-disabled batch (PRAGMA
-- foreign_keys = OFF around the whole run; each file is its own transaction).
-- Because FK enforcement is OFF, dropping an old parent table does NOT
-- cascade-delete children — the standard SQLite create-new/copy/drop/rename
-- table-rebuild is safe here.
--
-- ORDERING IS LOAD-BEARING: the entity_id -> slug backfills (steps 1-4) read
-- the soon-to-be-dropped `id` columns, so they MUST run before the entity
-- tables are rebuilt (step 5). Junctions/version are rebuilt last (step 6),
-- once the slug-PK parents exist for the FK declarations.
--
-- Orphan policy (brief slugpk001 / forimpl01 §2): rows whose entity was deleted
-- before this migration backfill to NULL and are dropped. Persistent history of
-- deleted/renamed entities lives in git (the entity JSON files), not here.

------------------------------------------------------------------------
-- STEP 1 — entity_version: entity_id -> entity_slug (reads old id columns)
------------------------------------------------------------------------
ALTER TABLE entity_version ADD COLUMN entity_slug TEXT;

UPDATE entity_version SET entity_slug =
  (SELECT slug FROM endpoint       WHERE endpoint.id       = entity_version.entity_id) WHERE entity_type = 'endpoint';
UPDATE entity_version SET entity_slug =
  (SELECT slug FROM dto            WHERE dto.id            = entity_version.entity_id) WHERE entity_type = 'dto';
UPDATE entity_version SET entity_slug =
  (SELECT slug FROM database_table WHERE database_table.id = entity_version.entity_id) WHERE entity_type = 'database-table';
UPDATE entity_version SET entity_slug =
  (SELECT slug FROM ui_view        WHERE ui_view.id        = entity_version.entity_id) WHERE entity_type = 'ui-view';
UPDATE entity_version SET entity_slug =
  (SELECT slug FROM ac             WHERE ac.id             = entity_version.entity_id) WHERE entity_type = 'ac';

DELETE FROM entity_version WHERE entity_slug IS NULL;  -- orphans (entity deleted pre-migration)

------------------------------------------------------------------------
-- STEP 2 — section_entity_link: entity_id -> entity_slug  [brief gap; spec #13]
------------------------------------------------------------------------
ALTER TABLE section_entity_link ADD COLUMN entity_slug TEXT;

UPDATE section_entity_link SET entity_slug =
  (SELECT slug FROM endpoint       WHERE endpoint.id       = section_entity_link.entity_id) WHERE entity_type = 'endpoint';
UPDATE section_entity_link SET entity_slug =
  (SELECT slug FROM dto            WHERE dto.id            = section_entity_link.entity_id) WHERE entity_type = 'dto';
UPDATE section_entity_link SET entity_slug =
  (SELECT slug FROM database_table WHERE database_table.id = section_entity_link.entity_id) WHERE entity_type = 'database-table';
UPDATE section_entity_link SET entity_slug =
  (SELECT slug FROM ui_view        WHERE ui_view.id        = section_entity_link.entity_id) WHERE entity_type = 'ui-view';
UPDATE section_entity_link SET entity_slug =
  (SELECT slug FROM ac             WHERE ac.id             = section_entity_link.entity_id) WHERE entity_type = 'ac';

DELETE FROM section_entity_link WHERE entity_slug IS NULL;

------------------------------------------------------------------------
-- STEP 3 — entity_tag: entity_id -> entity_slug, tag_id -> tag_slug
------------------------------------------------------------------------
ALTER TABLE entity_tag ADD COLUMN entity_slug TEXT;
ALTER TABLE entity_tag ADD COLUMN tag_slug TEXT;

UPDATE entity_tag SET tag_slug = (SELECT slug FROM tag WHERE tag.id = entity_tag.tag_id);

UPDATE entity_tag SET entity_slug =
  (SELECT slug FROM endpoint       WHERE endpoint.id       = entity_tag.entity_id) WHERE entity_type = 'endpoint';
UPDATE entity_tag SET entity_slug =
  (SELECT slug FROM dto            WHERE dto.id            = entity_tag.entity_id) WHERE entity_type = 'dto';
UPDATE entity_tag SET entity_slug =
  (SELECT slug FROM database_table WHERE database_table.id = entity_tag.entity_id) WHERE entity_type = 'database-table';
UPDATE entity_tag SET entity_slug =
  (SELECT slug FROM ui_view        WHERE ui_view.id        = entity_tag.entity_id) WHERE entity_type = 'ui-view';
UPDATE entity_tag SET entity_slug =
  (SELECT slug FROM ac             WHERE ac.id             = entity_tag.entity_id) WHERE entity_type = 'ac';

DELETE FROM entity_tag WHERE entity_slug IS NULL OR tag_slug IS NULL;

------------------------------------------------------------------------
-- STEP 4 — endpoint_dto: endpoint_id/dto_id -> endpoint_slug/dto_slug
------------------------------------------------------------------------
ALTER TABLE endpoint_dto ADD COLUMN endpoint_slug TEXT;
ALTER TABLE endpoint_dto ADD COLUMN dto_slug TEXT;

UPDATE endpoint_dto SET endpoint_slug = (SELECT slug FROM endpoint WHERE endpoint.id = endpoint_dto.endpoint_id);
UPDATE endpoint_dto SET dto_slug      = (SELECT slug FROM dto      WHERE dto.id      = endpoint_dto.dto_id);

DELETE FROM endpoint_dto WHERE endpoint_slug IS NULL OR dto_slug IS NULL;

------------------------------------------------------------------------
-- STEP 5 — rebuild the 5 entity tables + tag with slug as PRIMARY KEY
--          (column lists verified against the live schema).
------------------------------------------------------------------------
CREATE TABLE endpoint_new (
  slug TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO endpoint_new (slug, method, path, summary, description, created_at, updated_at)
  SELECT slug, method, path, summary, description, created_at, updated_at FROM endpoint;
DROP TABLE endpoint;
ALTER TABLE endpoint_new RENAME TO endpoint;

CREATE TABLE dto_new (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  fields TEXT NOT NULL DEFAULT '[]',
  examples TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO dto_new (slug, name, description, fields, examples, created_at, updated_at)
  SELECT slug, name, description, fields, examples, created_at, updated_at FROM dto;
DROP TABLE dto;
ALTER TABLE dto_new RENAME TO dto;

CREATE TABLE database_table_new (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  columns TEXT NOT NULL DEFAULT '[]',
  indexes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO database_table_new (slug, name, description, columns, indexes, created_at, updated_at)
  SELECT slug, name, description, columns, indexes, created_at, updated_at FROM database_table;
DROP TABLE database_table;
ALTER TABLE database_table_new RENAME TO database_table;

CREATE TABLE ui_view_new (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT,
  description TEXT,
  params TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO ui_view_new (slug, name, url, description, params, created_at, updated_at)
  SELECT slug, name, url, description, params, created_at, updated_at FROM ui_view;
DROP TABLE ui_view;
ALTER TABLE ui_view_new RENAME TO ui_view;

CREATE TABLE ac_new (
  slug TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'requirement',
  status TEXT NOT NULL DEFAULT 'active',
  verifies TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO ac_new (slug, text, kind, status, verifies, description, created_at, updated_at)
  SELECT slug, text, kind, status, verifies, description, created_at, updated_at FROM ac;
DROP TABLE ac;
ALTER TABLE ac_new RENAME TO ac;
CREATE INDEX idx_ac_status ON ac(status);
CREATE INDEX idx_ac_kind   ON ac(kind);

CREATE TABLE tag_new (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO tag_new (slug, name, color, description, created_at, updated_at)
  SELECT slug, name, color, description, created_at, updated_at FROM tag;
DROP TABLE tag;
ALTER TABLE tag_new RENAME TO tag;

------------------------------------------------------------------------
-- STEP 6 — rebuild junctions + version with slug columns + FKs
--          (parents now have slug PK, so the FK declarations resolve).
------------------------------------------------------------------------
-- ON UPDATE CASCADE: a slug rename of the parent (endpoint/dto) is an UPDATE of
-- the PK; cascade keeps the junction's FK columns in sync so renames don't trip
-- the FK constraint (FK enforcement is ON at runtime). ON DELETE CASCADE still
-- removes the link when the parent entity is deleted.
CREATE TABLE endpoint_dto_new (
  endpoint_slug TEXT NOT NULL REFERENCES endpoint(slug) ON DELETE CASCADE ON UPDATE CASCADE,
  dto_slug      TEXT NOT NULL REFERENCES dto(slug)      ON DELETE CASCADE ON UPDATE CASCADE,
  relation TEXT NOT NULL,
  status_code INTEGER,
  UNIQUE(endpoint_slug, dto_slug, relation, status_code)
);
INSERT INTO endpoint_dto_new (endpoint_slug, dto_slug, relation, status_code)
  SELECT endpoint_slug, dto_slug, relation, status_code FROM endpoint_dto;
DROP TABLE endpoint_dto;
ALTER TABLE endpoint_dto_new RENAME TO endpoint_dto;
CREATE INDEX idx_endpoint_dto_endpoint ON endpoint_dto(endpoint_slug);
CREATE INDEX idx_endpoint_dto_dto      ON endpoint_dto(dto_slug);

CREATE TABLE entity_tag_new (
  entity_type TEXT NOT NULL,
  entity_slug TEXT NOT NULL,                       -- polymorphic, NOT a FK (entity rename followed explicitly in services)
  tag_slug    TEXT NOT NULL REFERENCES tag(slug) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE(entity_type, entity_slug, tag_slug)
);
INSERT INTO entity_tag_new (entity_type, entity_slug, tag_slug)
  SELECT entity_type, entity_slug, tag_slug FROM entity_tag;
DROP TABLE entity_tag;
ALTER TABLE entity_tag_new RENAME TO entity_tag;
CREATE INDEX idx_entity_tag_tag_slug ON entity_tag(tag_slug);
CREATE INDEX idx_entity_tag_entity   ON entity_tag(entity_type, entity_slug);

CREATE TABLE section_entity_link_new (
  anchor TEXT NOT NULL REFERENCES section_index(anchor) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_slug TEXT NOT NULL,                       -- polymorphic, NOT a FK
  relation TEXT NOT NULL DEFAULT 'describes',
  UNIQUE(anchor, entity_type, entity_slug)
);
INSERT INTO section_entity_link_new (anchor, entity_type, entity_slug, relation)
  SELECT anchor, entity_type, entity_slug, relation FROM section_entity_link;
DROP TABLE section_entity_link;
ALTER TABLE section_entity_link_new RENAME TO section_entity_link;
CREATE INDEX idx_sel_anchor ON section_entity_link(anchor);
CREATE INDEX idx_sel_entity ON section_entity_link(entity_type, entity_slug);

CREATE TABLE entity_version_new (
  entity_type TEXT NOT NULL,
  entity_slug TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  change_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  release_id INTEGER NULL,
  serializer_version TEXT NULL,
  op TEXT NULL,
  PRIMARY KEY (entity_type, entity_slug, version)
);
INSERT INTO entity_version_new
  (entity_type, entity_slug, version, data, changed_by, change_summary, created_at, release_id, serializer_version, op)
  SELECT entity_type, entity_slug, version, data, changed_by, change_summary, created_at, release_id, serializer_version, op
  FROM entity_version;
DROP TABLE entity_version;
ALTER TABLE entity_version_new RENAME TO entity_version;
CREATE INDEX idx_ev_entity             ON entity_version(entity_type, entity_slug);
CREATE INDEX idx_entity_version_release ON entity_version(release_id);

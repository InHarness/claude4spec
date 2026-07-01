-- 0.1.96 multiroot — key section_index / section_entity_link by (rootId, path).
-- A section now belongs to a specific SECTION-INDEXED root (the built-in 'pages'
-- root or a user-defined root slug). `rootId` is DYNAMIC — no CHECK constraint,
-- no replacement enum. Existing rows all remap to the built-in 'pages' root.
--
-- Anchors stay GLOBALLY unique: a single 8-char id resolves to exactly one
-- section across every root, so <section_ref/> / @path#anchor resolution and the
-- section_entity_link → section_index(anchor) FK keep working WITHOUT a rootId
-- qualifier. Do NOT add rootId to the anchor uniqueness.
--
-- Follows the 028/043 rebuild pattern (rename → create → copy → drop → recreate
-- indexes). migrate.ts toggles PRAGMA foreign_keys OFF around the batch, so the
-- section_entity_link → section_index(anchor) FK does not block the section_index
-- rebuild.

-- section_index: add rootId (default 'pages'); page-scoped lookups key on
-- (rootId, page_path). anchor UNIQUE stays global.
ALTER TABLE section_index RENAME TO section_index_old;

CREATE TABLE section_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rootId TEXT NOT NULL DEFAULT 'pages',
  anchor TEXT UNIQUE NOT NULL,
  page_path TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  heading_slug TEXT NOT NULL,
  heading_level INTEGER NOT NULL,
  heading_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  paragraph_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO section_index (
  id, rootId, anchor, page_path, heading_path, heading_slug, heading_level,
  heading_text, content_hash, line_start, line_end, paragraph_count,
  created_at, updated_at
)
SELECT
  id, 'pages', anchor, page_path, heading_path, heading_slug, heading_level,
  heading_text, content_hash, line_start, line_end, paragraph_count,
  created_at, updated_at
FROM section_index_old;

DROP TABLE section_index_old;

CREATE INDEX idx_si_root_page ON section_index(rootId, page_path);
CREATE INDEX idx_si_hash ON section_index(content_hash);

-- section_entity_link: add rootId (default 'pages'); UNIQUE + entity index gain
-- rootId. The anchor FK stays (anchor is globally unique); per-page deletes run
-- as (rootId, anchor IN <page's anchors>).
ALTER TABLE section_entity_link RENAME TO section_entity_link_old;

CREATE TABLE section_entity_link (
  rootId TEXT NOT NULL DEFAULT 'pages',
  anchor TEXT NOT NULL REFERENCES section_index(anchor) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_slug TEXT NOT NULL,                       -- polymorphic, NOT a FK
  relation TEXT NOT NULL DEFAULT 'describes',
  UNIQUE(rootId, anchor, entity_type, entity_slug)
);

INSERT INTO section_entity_link (rootId, anchor, entity_type, entity_slug, relation)
  SELECT 'pages', anchor, entity_type, entity_slug, relation FROM section_entity_link_old;

DROP TABLE section_entity_link_old;

CREATE INDEX idx_sel_anchor ON section_entity_link(anchor);
CREATE INDEX idx_sel_entity ON section_entity_link(rootId, entity_type, entity_slug);

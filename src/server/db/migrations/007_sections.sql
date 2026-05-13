CREATE TABLE section_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

CREATE INDEX idx_si_page ON section_index(page_path);
CREATE INDEX idx_si_hash ON section_index(content_hash);

CREATE TABLE section_entity_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anchor TEXT NOT NULL REFERENCES section_index(anchor) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  relation TEXT NOT NULL DEFAULT 'describes',
  UNIQUE(anchor, entity_type, entity_id)
);

CREATE INDEX idx_sel_anchor ON section_entity_link(anchor);
CREATE INDEX idx_sel_entity ON section_entity_link(entity_type, entity_id);

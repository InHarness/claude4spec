-- 0.2.46 — `section_index` materializes section content: the new `body` column.
--
-- `body` is the section AS AUTHORED — the raw slice between the section's
-- boundaries, WITHOUT the heading line and WITHOUT the anchor comment line, and
-- WITHOUT normalization. Normalization (`normalizeContent`) keeps feeding
-- `content_hash` and nothing else; substituting it here would make the column a
-- second, lossy hash input instead of the content.
--
-- Materialization, NOT emission. No generic operation hands this column out:
-- `list_sections` stays a skeleton and `GET /api/sections` emits only a
-- truncated `contentSnippet` (a prefix of this column). A read of one section
-- is where full content comes from.
--
-- Why a full rebuild rather than `ALTER TABLE ... ADD COLUMN`: the column is
-- NOT NULL with NO default and sits between `content_hash` and `line_start`.
-- `ADD COLUMN` can do neither — it appends, and SQLite requires a default for a
-- NOT NULL addition. tests/integration/db/baseline-identity.test.ts compares the
-- baseline and the replayed chain POSITIONALLY (cid, notnull, dflt_value), so an
-- appended column with a default would diverge from `000_baseline.sql`. Same
-- rename -> create -> copy -> drop -> recreate-indexes shape as 044/046.
--
-- migrate.ts toggles PRAGMA foreign_keys OFF around the batch, so the
-- section_entity_link -> section_index(anchor) FK does not block the rebuild.
--
-- The rebuild is build-new -> drop-old -> RENAME INTO PLACE, NOT 044's
-- rename-old-aside -> create -> copy -> drop. That difference is load-bearing:
-- `ALTER TABLE section_index RENAME TO section_index_old` also REWRITES every FK
-- clause pointing at it, so `section_entity_link` would be left referencing
-- `section_index_old` — a table this migration then drops. 044 got away with it
-- only because it rebuilt `section_entity_link` in the same file and restated the
-- FK. Renaming a table nothing references cannot rewrite anything, so
-- `section_entity_link` is left completely untouched here.
--
-- Existing rows are copied with body = '' — a TRANSITIONAL migration state, not
-- an acceptable resting state. The boot-time `SectionIndexerService.indexAll()`
-- reindexes every page in every section-indexed root and refills the column with
-- real content on the first start after this migration.
--
-- No index changes: `idx_si_hash` and `idx_si_root_page` are recreated exactly
-- as they were, and anchor uniqueness stays the inline global UNIQUE (see 044 --
-- do NOT qualify it with rootId).

CREATE TABLE section_index_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rootId TEXT NOT NULL DEFAULT 'pages',
  anchor TEXT UNIQUE NOT NULL,
  page_path TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  heading_slug TEXT NOT NULL,
  heading_level INTEGER NOT NULL,
  heading_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  paragraph_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO section_index_new (
  id, rootId, anchor, page_path, heading_path, heading_slug, heading_level,
  heading_text, content_hash, body, line_start, line_end, paragraph_count,
  created_at, updated_at
)
SELECT
  id, rootId, anchor, page_path, heading_path, heading_slug, heading_level,
  heading_text, content_hash, '', line_start, line_end, paragraph_count,
  created_at, updated_at
FROM section_index;

DROP TABLE section_index;

ALTER TABLE section_index_new RENAME TO section_index;

CREATE INDEX idx_si_hash ON section_index(content_hash);
CREATE INDEX idx_si_root_page ON section_index(rootId, page_path);

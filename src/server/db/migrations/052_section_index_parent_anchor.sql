-- 0.2.59 — `section_index` carries the tree: `parent_anchor` in, `heading_path` out.
--
-- The need comes from M39 (`list_sections` is replaced by `get_page_outline`,
-- which answers with a TREE of headings in document order), but the schema change
-- belongs to M06, which owns the table.
--
-- WHY `heading_path` GOES. It stored the ancestor chain slash-joined into one TEXT
-- field, and that encoding had a bug built into it: a heading containing `/` split
-- into two elements on read, because the separator was also a content character.
-- It was also an array encoded in a string, so every reader paid to parse it. The
-- job it did — orienting a caller in the hierarchy without a second call — is done
-- better by POSITION IN THE TREE that `get_page_outline` returns.
--
-- WHY `parent_anchor` COMES. It is the ONLY carrier of the parent-child relation in
-- this otherwise flat table. Without it `get_page_outline` would have to reconstruct
-- the hierarchy from `heading_level` plus line order on every call — re-deriving what
-- the indexer already computed while walking the file. It is derived deterministically
-- in the SAME parser pass that fixes `line_start`/`line_end`; no new indexing step.
--
-- NULL for a page's first (root) section, otherwise the anchor of the enclosing
-- heading. NOT necessarily the nearest heading by level: a heading whose anchor lost
-- a within-page duplicate collision shapes nesting but owns no row, so the indexer
-- points past it to the nearest ancestor that DOES have a row. A dangling FK here
-- would be worse than a shallower tree.
--
-- ON DELETE SET NULL, not a bare reference. Deleting a section that still has
-- children is ordinary: a page loses a heading and its subsections re-parent onto
-- whatever encloses them. Enforcement is live (`openDbAt` sets
-- `PRAGMA foreign_keys = ON`), so without the clause a page edit that dropped a
-- parent and one of its children in the same pass could fail on delete ORDER
-- alone. Promoting an orphan to a page-level root is both the truthful outcome
-- and the state the next reindex writes anyway.
--
-- NO `depth` COLUMN. It was considered and rejected: the level is already in
-- `heading_level`, and the depth falls out of `parent_anchor` in the same pass that
-- builds the tree. A third carrier of the same fact earns nothing.
--
-- `heading_level` keeps its type and nullability; only its meaning is sharpened.
-- It is NOT derivable from tree depth — Markdown allows level jumps (`##` -> `####`),
-- so depth != level, and both are needed.
--
-- Why a full rebuild rather than ADD COLUMN + DROP COLUMN: SQLite's `DROP COLUMN` is
-- unavailable on older engines, and `tests/integration/db/baseline-identity.test.ts`
-- compares the baseline and the replayed chain POSITIONALLY (cid, notnull,
-- dflt_value) — an appended column would diverge from a baseline that never had one.
--
-- Same build-new -> drop-old -> RENAME INTO PLACE shape as 051, and for the same
-- reason: `ALTER TABLE section_index RENAME TO section_index_old` would also REWRITE
-- the FK clause in `section_entity_link`, leaving it pointing at a table this file
-- then drops. Renaming a table nothing references cannot rewrite anything, so
-- `section_entity_link` is left completely untouched here.
--
-- migrate.ts toggles PRAGMA foreign_keys OFF around the batch, so the
-- section_entity_link -> section_index(anchor) FK does not block the rebuild.
--
-- Existing rows are copied with parent_anchor = NULL — a TRANSITIONAL state, not an
-- acceptable resting one. Every outline would come back flat until the boot-time
-- `SectionIndexerService.indexAll()` reindexes every page in every section-indexed
-- root and fills the column in. That boot pass is the ONLY repair path and it is
-- fire-and-forget (project-context.ts: `indexAll().catch(console.error)`), exactly as
-- documented for `body` in 051; a restart repairs it, nothing else does. Nothing is
-- lost meanwhile — anchors, coordinates and hashes are untouched.
--
-- No index changes: `idx_si_hash` and `idx_si_root_page` are recreated exactly as they
-- were, and anchor uniqueness stays the inline global UNIQUE (see 044 -- do NOT
-- qualify it with rootId). There is no `uq_si_anchor` and no `idx_si_page`; 044
-- replaced the latter with `idx_si_root_page`.

CREATE TABLE section_index_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rootId TEXT NOT NULL DEFAULT 'pages',
  anchor TEXT UNIQUE NOT NULL,
  page_path TEXT NOT NULL,
  parent_anchor TEXT NULL REFERENCES section_index(anchor) ON DELETE SET NULL,
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
  id, rootId, anchor, page_path, parent_anchor, heading_slug, heading_level,
  heading_text, content_hash, body, line_start, line_end, paragraph_count,
  created_at, updated_at
)
SELECT
  id, rootId, anchor, page_path, NULL, heading_slug, heading_level,
  heading_text, content_hash, body, line_start, line_end, paragraph_count,
  created_at, updated_at
FROM section_index;

DROP TABLE section_index;

ALTER TABLE section_index_new RENAME TO section_index;

CREATE INDEX idx_si_hash ON section_index(content_hash);
CREATE INDEX idx_si_root_page ON section_index(rootId, page_path);

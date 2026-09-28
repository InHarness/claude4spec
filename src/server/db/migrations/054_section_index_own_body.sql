-- 2.0.0 — `section_index` stores a section's OWN body, and its subtree end apart.
--
-- The shared section parser (M06, `src/shared/section-parser.ts`) separates a
-- section's own body (up to the next section of ANY level) from its subtree (up
-- to the next section of the same or a higher level). The index now follows it:
--
--  - `body`, `content_hash`, `line_end`, `paragraph_count` describe the OWN body,
--    so a change inside a subsection no longer changes its parent's hash. Equal
--    hashes of different sections (parents with no prose of their own) are
--    expected — the hash is not an identity;
--  - `line_start` is the first line of the anchor block (the heading line when
--    there is no anchor);
--  - `subtree_line_end` (NEW) is where whole-section write actions (`replace`,
--    `delete`, `insert_after`, `edit`) stop;
--  - `heading_slug` goes — derivable from `heading_text`, and sections are
--    addressed by anchor, never by slug;
--  - `idx_si_hash` goes — no query looks rows up by hash.
--
-- THE TABLE IS EMPTIED. Every row was computed under the old boundaries, so none
-- is correct under the new ones; the boot-time full rebuild refills it, and a
-- section write attempted before that first rebuild completes answers
-- `INDEX_STALE`. `DEFAULT 0` on `subtree_line_end` exists only because
-- `ADD COLUMN … NOT NULL` needs a default — the emptying, not that value, is what
-- keeps the column correct.
--
-- Same build-new -> drop-old -> RENAME INTO PLACE shape as 051/052 (renaming the
-- old table aside would rewrite the FK in `section_entity_link`). The links hang
-- off `section_index(anchor)` ON DELETE CASCADE; they are emptied too and rebuilt
-- by the same pass.

DELETE FROM section_entity_link;

CREATE TABLE section_index_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rootId TEXT NOT NULL DEFAULT 'pages',
  anchor TEXT UNIQUE NOT NULL,
  page_path TEXT NOT NULL,
  parent_anchor TEXT NULL REFERENCES section_index(anchor) ON DELETE SET NULL,
  heading_level INTEGER NOT NULL,
  heading_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  subtree_line_end INTEGER NOT NULL DEFAULT 0,
  paragraph_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

DROP TABLE section_index;

ALTER TABLE section_index_new RENAME TO section_index;

CREATE INDEX idx_si_root_page ON section_index(rootId, page_path);

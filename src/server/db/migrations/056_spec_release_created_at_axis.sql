-- 2.1.4 (M17): the release AXIS is `ORDER BY created_at, id`, not `id`.
--
-- `spec_release` is a cache rebuilt from `<releasesDir>/<slug>.json`. On a
-- rebuilt database `id`s follow directory order (alphabetical by slug, so
-- `v0-10` < `v0-8`), and a release file pulled in through git gets a fresh,
-- higher `id` although it was created earlier. `id` therefore cannot order
-- releases; `created_at` — stamped by createRelease with the same value as the
-- file's `createdAt` and copied from the file verbatim on rebuild — does.
--
-- Two schema changes, both requiring a table rebuild in SQLite:
--   * `created_at` loses `DEFAULT (datetime('now'))`. The column is compared as
--     text, so one format (ISO 8601 UTC with ms) is a precondition of a correct
--     order; `datetime('now')` (seconds, space instead of `T`) sorts against it
--     out of time order. The application always supplies the value.
--   * `idx_spec_release_created_at` covers the tie-break: (created_at, id).
--
-- No data migration: existing rows are overwritten from the files' `createdAt`
-- by the boot reindex (upsert by slug sets `created_at = excluded.created_at`).
-- `release_push` / `release_import` reference spec_release(id); ids are copied
-- unchanged, and the `_new` → rename pattern leaves those FK declarations intact.

CREATE TABLE spec_release_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL CHECK (length(trim(description)) > 0),
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  slug         TEXT,
  roots        TEXT
);
INSERT INTO spec_release_new (id, name, description, created_by, created_at, slug, roots)
  SELECT id, name, description, created_by, created_at, slug, roots FROM spec_release;

-- Preserve the AUTOINCREMENT high-water mark across the rebuild.
INSERT OR REPLACE INTO sqlite_sequence (name, seq)
  SELECT 'spec_release_new', seq FROM sqlite_sequence WHERE name = 'spec_release';

DROP TABLE spec_release;
ALTER TABLE spec_release_new RENAME TO spec_release;

CREATE INDEX idx_spec_release_created_at ON spec_release(created_at, id);
CREATE UNIQUE INDEX idx_spec_release_slug ON spec_release(slug);

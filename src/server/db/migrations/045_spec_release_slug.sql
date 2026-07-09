-- 0.1.118: spec_release becomes a derived cache rebuilt from releasesDir/<slug>.json
-- (M29-style). `slug` keys the upsert-by-slug rebuild so `id` (referenced by the
-- loose entity_version.release_id / page_version.release_id FKs) survives across
-- rebuilds. SQLite UNIQUE allows multiple NULLs, so pre-existing releases (born
-- before this feature, no backing file) keep slug = NULL forever and are never
-- touched by the file-driven upsert/unlink logic.

ALTER TABLE spec_release ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX idx_spec_release_slug ON spec_release(slug);

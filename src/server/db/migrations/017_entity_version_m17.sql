-- M17 Spec Snapshots & Releases — Phase 3
-- Extend entity_version with release_id (FK to spec_release added in 019),
-- serializer_version (per-type semver), and op (create | update | delete).

ALTER TABLE entity_version ADD COLUMN release_id INTEGER NULL;
ALTER TABLE entity_version ADD COLUMN serializer_version TEXT NULL;
ALTER TABLE entity_version ADD COLUMN op TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_entity_version_release ON entity_version(release_id);

-- Best-effort backfill of `op` for existing rows. Heuristic:
--   data = 'null'                                                   -> delete
--   first version per (entity_type, entity_id)                      -> create
--   everything else                                                 -> update
UPDATE entity_version SET op = 'delete' WHERE data = 'null' AND op IS NULL;

UPDATE entity_version SET op = 'create' WHERE id IN (
  SELECT MIN(id) FROM entity_version
   WHERE op IS NULL OR op = ''
   GROUP BY entity_type, entity_id
) AND (op IS NULL OR op = '');

UPDATE entity_version SET op = 'update' WHERE op IS NULL;

-- 2.1.55 (M27 removed): the application no longer clones a remote project at
-- start, so the clone audit log goes with the feature. `release_import` was
-- written only by the clone service and had no reader; no other table
-- references it (it pointed at spec_release, never the other way round), so
-- dropping it touches nothing else. Its rows were a local transport log with no
-- reader left — nothing to carry over.

DROP INDEX IF EXISTS idx_release_import_local_release;
DROP TABLE IF EXISTS release_import;

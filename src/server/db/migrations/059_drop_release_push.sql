-- 2.1.55 (M25 removed): the application no longer pushes releases to the remote
-- server, so the push audit log goes with the feature. `release_push` was
-- written only by the release-push service and read only by its routes; no
-- other table references it, so dropping it touches nothing else. Its rows were
-- a local transport log with no reader left — nothing to carry over.
--
-- `remote_session` (M24) is untouched: it never pointed at `release_push`, and
-- the pushed-by identity was a snapshot copied into the dropped rows.

DROP INDEX IF EXISTS idx_release_push_release_id;
DROP INDEX IF EXISTS idx_release_push_remote_release_id;
DROP TABLE IF EXISTS release_push;

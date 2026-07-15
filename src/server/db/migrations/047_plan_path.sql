-- 0.1.127 M10/M36: plan -> filesystem migration, additive half.
--
-- This migration ONLY adds the new `chat_thread.plan_path` column + its index.
-- It deliberately does NOT touch `plan_id`/`last_seen_plan_version`/`plan`/
-- `plan_version` — the migration runner (db/migrate.ts) applies every pending
-- .sql file in one batch before any application code runs, so a destructive
-- DROP here would run before the boot-time backfill (workspace/plan-migration.ts)
-- ever gets a chance to read the legacy `plan` rows and write them to
-- `plansDir/*.md`. That backfill runs once per project at boot (guarded on the
-- `plan` table still existing) and performs the DROP TABLE/column-rebuild
-- itself, in the same transaction as the data migration, after every plan file
-- has been written successfully.

ALTER TABLE chat_thread ADD COLUMN plan_path TEXT;

CREATE INDEX idx_chat_thread_plan_path ON chat_thread(plan_path) WHERE plan_path IS NOT NULL;

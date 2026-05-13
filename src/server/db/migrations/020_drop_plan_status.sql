-- Etap: M10 — wycofanie statusu planu (spec change).
-- Spec: .claude/skills/specyfikacja/db/db-m10-plans.md, modules/m10-plans.md
-- Decyzja: plan_version jest jedynym audit trail; wiersz `plan` nie mutuje przy execute.

DROP INDEX IF EXISTS idx_plan_status;

ALTER TABLE plan DROP COLUMN status;
ALTER TABLE plan DROP COLUMN accepted_at;
ALTER TABLE plan DROP COLUMN accepted_mode;
ALTER TABLE plan DROP COLUMN accepted_thread_id;

-- 2.1.88 (M44 / M21 `gll5xhtr`) — chat_thread.context_type loses its default,
-- and chat_thread gains `consultation` (the thread's origin).
--
-- `context_type` stays `TEXT NOT NULL`, still without a SQL CHECK (L1), but no
-- longer `DEFAULT 'chat'`: the application always writes the value, and a
-- thread opened without a type gets the registry's `Wejście: domyślny` value.
-- The enum is gone too — the legal values are the project's registry rows.
--
-- `consultation` = 1 marks a thread founded on another project's request (set
-- once at creation by the consultation entry, M11); 0 for every other thread,
-- which is what every existing row is.
--
-- SQLite cannot drop a column DEFAULT in place, so the table is rebuilt. The
-- rebuild is the code step `064_chat_thread_context_type_no_default`
-- (code-migrations.ts), not SQL: the column set differs between databases
-- (the plan cutover, plan-migration.ts, drops `plan_id` /
-- `last_seen_plan_version` at boot, so a database may be upgraded with or
-- without them), and the step rebuilds from the table's own definition.

ALTER TABLE chat_thread ADD COLUMN consultation INTEGER NOT NULL DEFAULT 0;

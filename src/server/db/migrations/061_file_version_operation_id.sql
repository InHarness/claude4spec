-- 2.1.57 (M42 gg7sxih6 / M17): a multi-file operation leaves ONE identifier in
-- the history. Every `file_version` row written by one operation that writes N
-- files — its rollback rows included — carries the same `operation_id`, so a
-- half-applied state can be found and undone as a whole rather than as N
-- unrelated versions. NULL = a single-file write: every existing row, and every
-- write outside a multi-file operation. No transaction over N files is
-- introduced; the column only names the operation.

ALTER TABLE file_version ADD COLUMN operation_id TEXT;
CREATE INDEX IF NOT EXISTS idx_file_version_operation_id ON file_version(operation_id);

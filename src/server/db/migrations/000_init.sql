-- Etap 1 base migration. Intentionally empty of entity tables —
-- schema_migrations row gets created to prove the runner works.
-- Entity tables (endpoint, dto, ...) land in later migrations.

CREATE TABLE IF NOT EXISTS _init_marker (
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

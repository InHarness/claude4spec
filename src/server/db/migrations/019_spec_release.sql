-- M17 Spec Snapshots & Releases — Phase 5
-- spec_release: meta record per named snapshot. entity_version and page_version
-- already carry release_id (loose INTEGER NULL — FK enforced in app layer).

CREATE TABLE spec_release (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,                                              -- "v1.0.0", "pre-launch"
  description  TEXT NOT NULL CHECK (length(trim(description)) > 0),               -- decyzja 5
  created_by   TEXT NOT NULL,                                                     -- "user" | "agent"
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_spec_release_created_at ON spec_release(created_at DESC);

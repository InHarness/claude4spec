-- v0.1.59 — Design System entity (sixth entity type).
-- Derived index (M29): rebuilt from .claude4spec/entities/design-system/<slug>.json.
-- slug is the natural PK (kebab-case from slugify(name)) — no integer id.
-- `groups`/`modes` are embedded JSON (params-in-ui_view pattern); zero junction tables.
-- Polymorphic entity_tag (001_endpoint.sql) and entity_version (017_entity_version_m17.sql)
-- handle entity_type='design-system' without extra schema.

CREATE TABLE IF NOT EXISTS design_system (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  groups      TEXT NOT NULL DEFAULT '[]',
  modes       TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

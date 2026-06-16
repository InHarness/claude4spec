-- v0.1.64 — Diagram entity (seventh entity type).
-- Derived index (M29): rebuilt from .claude4spec/entities/diagram/<slug>.json.
-- slug is the natural PK (kebab-case; explicit | slugify(caption) | diagram-<nanoid(8)>)
-- — no integer id. `source` is the literal DSL body (mermaid); kept verbatim (no trim),
-- may be empty (placeholder). NO `caption` column — caption lives only as the
-- `<diagram caption="…"/>` reference attribute on a page. Diagram is a graph leaf:
-- zero junction tables, references no other entity.
-- Polymorphic entity_tag (001_endpoint.sql) and entity_version (017_entity_version_m17.sql)
-- handle entity_type='diagram' without extra schema.

CREATE TABLE IF NOT EXISTS diagram (
  slug       TEXT NOT NULL PRIMARY KEY,
  format     TEXT NOT NULL DEFAULT 'mermaid',
  source     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

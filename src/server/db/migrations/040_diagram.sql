-- v0.1.64 — Diagram entity. HISTORICAL migration, kept frozen in the legacy chain.
--
-- It predates the 0.2.2 baseline cut: a fresh database never runs it (the
-- baseline pre-seeds its ledger row), and only an old database replaying the
-- chain ever did. The host does not declare a `diagram` table. Since 2.1.63
-- `diagram` is a plugin type, delivered by the prebuilt envelope
-- `plugins/c4s-plugin-diagram/`, and its table — like every entity table — is a
-- projection the host GENERATES from that type's `data.schema` (M13 L1); the
-- host migration chain holds host tables only (`tag`/`entity_tag`,
-- `entity_version`/`file_version`/`spec_release`, `section_index`, runtime
-- state). The DDL below is what v0.1.64 wrote, not the current shape, and is
-- not to be edited: an already-applied migration that changes is a silent
-- divergence between installations.

CREATE TABLE IF NOT EXISTS diagram (
  slug       TEXT NOT NULL PRIMARY KEY,
  format     TEXT NOT NULL DEFAULT 'mermaid',
  source     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

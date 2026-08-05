-- 000_baseline.sql — the host schema, as of 0.2.2.
--
-- THE FRESH-INSTALL PATH. `runMigrations` executes this file, and ONLY this
-- file, when `schema_migrations` is empty; it then records every historical
-- version 000_init..049 as applied so the chain is never replayed. A database
-- that already has rows in `schema_migrations` skips this file entirely and
-- keeps replaying the chain — no installed database changes path.
--
-- Why the cut: while entity DDL lived in the chain, later host migrations
-- referenced entity tables, so the two could not be separated on a fresh
-- database. This baseline severs that dependency.
--
-- WHAT IS NOT HERE. No entity tables, and as of 0.2.11 no exceptions. Every
-- entity table is a GENERATED projection: the host derives it from the type's
-- logical `data.schema` when the ProjectContext is built, and regenerates rather
-- than migrates it. `database_table` was the last table created here -- it was
-- grandfathered because its type comes from an external plugin with no in-repo
-- module to own the DDL. That exception is what made `database-table` a
-- privileged type in the migration chain, so it goes: the plugin that
-- contributes the type also contributes the projection that creates its table.
--
-- Also absent: `schema_migrations` (the runner creates it) and
-- `plugin_schema_migrations` (created lazily by the plugin runner).
--
-- Statements are plain CREATE TABLE, not IF NOT EXISTS, deliberately: if the
-- fresh-path detection is ever wrong this must fail loudly rather than bind
-- itself to a schema it did not create.
--
-- Keeping this honest is `tests/integration/db/baseline-identity.test.ts`,
-- which asserts that baseline + every core module migration produces the same
-- logical schema as the full historical chain. Edit the two together.

CREATE TABLE _init_marker (
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE agent_credential (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  provider           TEXT NOT NULL DEFAULT 'anthropic',
  api_key_ciphertext TEXT NOT NULL,   -- AES-256-GCM, base64 "iv|authTag|ciphertext"
  key_last4          TEXT NOT NULL,   -- last 4 chars of plaintext, for masked preview only
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE chat_background_task (
  thread_id TEXT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  output_file TEXT,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (thread_id, task_id)
);
CREATE TABLE chat_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  subagent_task_id TEXT,
  plan_mode INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'complete',
  usage_json TEXT,
  context_size INTEGER
);
CREATE TABLE chat_queued_message (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id        TEXT    NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,            -- monotonic per-thread order
  prompt           TEXT    NOT NULL,            -- markdown with serialized PageRefNode (same as POST /api/chat body)
  annotations_json TEXT,                        -- annotations snapshot at enqueue (shape: annotations field of POST /api/chat)
  current_page     TEXT,                        -- current page context at enqueue (path), NULL when absent
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE chat_subagent_task (
  thread_id TEXT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  tool_use_id TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (thread_id, task_id)
);
CREATE TABLE chat_thread (
  id                               TEXT PRIMARY KEY NOT NULL,
  title                            TEXT,
  last_session_id                  TEXT,
  created_at                       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                       TEXT NOT NULL DEFAULT (datetime('now')),
  current_todo_items               TEXT,
  plan_mode                        INTEGER NOT NULL DEFAULT 0,
  initial_system_prompt            TEXT,
  last_usage_json                  TEXT,
  plan_id                          INTEGER REFERENCES plan(id) ON DELETE SET NULL,
  last_seen_plan_version           INTEGER,
  last_context_size                INTEGER,
  context_type                     TEXT NOT NULL DEFAULT 'chat',
  brief_path                       TEXT,
  patch_path                       TEXT,
  initial_architecture_config_json TEXT,
  parent_thread_id                 TEXT REFERENCES chat_thread(id) ON DELETE CASCADE,
  spawned_by_tool_use_id           TEXT,
  plan_path                        TEXT
);
CREATE TABLE entity_tag (
  entity_type TEXT NOT NULL,
  entity_slug TEXT NOT NULL,                       -- polymorphic, NOT a FK (entity rename followed explicitly in services)
  tag_slug    TEXT NOT NULL REFERENCES tag(slug) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE(entity_type, entity_slug, tag_slug)
);
CREATE TABLE entity_version (
  entity_type TEXT NOT NULL,
  entity_slug TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  change_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  release_id INTEGER NULL,
  serializer_version TEXT NULL,
  op TEXT NULL,
  PRIMARY KEY (entity_type, entity_slug, version)
);
CREATE TABLE file_version (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  path                TEXT NOT NULL,
  version             INTEGER NOT NULL,
  data                TEXT NOT NULL,
  serializer_version  TEXT NOT NULL,
  op                  TEXT NOT NULL CHECK (op IN ('create', 'update', 'delete')),
  release_id          INTEGER NULL,
  changed_by          TEXT NOT NULL CHECK (changed_by IN ('user', 'agent', 'filesystem')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  rootId              TEXT NOT NULL DEFAULT 'pages',
  change_summary      TEXT NULL,

  CONSTRAINT uq_file_version_path_root_version UNIQUE(path, rootId, version)
);
CREATE TABLE plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE plan_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  action TEXT NOT NULL,
  action_params TEXT,
  change_summary TEXT,
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE release_import (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  local_release_id          INTEGER REFERENCES spec_release(id),  -- nullable, no ON DELETE
  remote_project_id         TEXT,                                 -- ← X-Project-Id
  remote_project_slug       TEXT    NOT NULL,                     -- user input, always known
  remote_release_id         TEXT,                                 -- ← X-Release-Id
  remote_release_sequence   INTEGER,                              -- ← X-Release-Sequence
  content_sha256            TEXT,                                 -- ← X-Content-SHA256
  content_size_bytes        INTEGER,                              -- ← Content-Length
  bundle_schema_version     INTEGER,                              -- ← bundle manifest (NOT a header)
  imported_by_account_id    TEXT,                                 -- NULL for anon v1 clone
  imported_by_account_email TEXT,                                 -- NULL for anon v1 clone
  status                    TEXT    NOT NULL,                     -- 'success' | 'error' (app-validated, no SQL CHECK)
  error_message             TEXT,                                 -- only when status='error'
  imported_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE release_push (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id               INTEGER NOT NULL REFERENCES spec_release(id),
  remote_project_id        TEXT,                            -- UUID; NULL only for first-push error rows
  remote_release_id        TEXT,                            -- UUID of the release on the remote; NULL on error
  remote_release_sequence  INTEGER,                         -- per-project sequence; NULL on error
  content_sha256           TEXT    NOT NULL,                -- lowercase hex64; from M17.buildBundleArchive
  content_size_bytes       INTEGER NOT NULL,                -- from M17.buildBundleArchive
  deduplicated             INTEGER NOT NULL DEFAULT 0,      -- 0 or 1; the peer dedups by SHA
  pushed_by_account_id     TEXT    NOT NULL,                -- snapshot of remote_session.remote_account_id
  pushed_by_account_email  TEXT,                            -- snapshot of remote_session.account_email (cached identity)
  bundle_schema_version    INTEGER NOT NULL,                -- from M17.buildBundleArchive
  status                   TEXT    NOT NULL,                -- 'success' | 'error'; validated in app (no SQL CHECK)
  error_message            TEXT,                            -- populated only for status='error'
  pushed_at                TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE remote_session (
  id                INTEGER PRIMARY KEY,
  access_token      TEXT NOT NULL,
  token_id          TEXT NOT NULL,
  issued_at         TEXT NOT NULL,
  remote_account_id TEXT NOT NULL,
  account_email     TEXT NOT NULL,
  account_status    TEXT NOT NULL,
  connected_at      TEXT NOT NULL DEFAULT (datetime('now')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE section_entity_link (
  rootId TEXT NOT NULL DEFAULT 'pages',
  anchor TEXT NOT NULL REFERENCES section_index(anchor) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_slug TEXT NOT NULL,                       -- polymorphic, NOT a FK
  relation TEXT NOT NULL DEFAULT 'describes',
  UNIQUE(rootId, anchor, entity_type, entity_slug)
);
CREATE TABLE section_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rootId TEXT NOT NULL DEFAULT 'pages',
  anchor TEXT UNIQUE NOT NULL,
  page_path TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  heading_slug TEXT NOT NULL,
  heading_level INTEGER NOT NULL,
  heading_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  paragraph_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE spec_release (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,                                              -- "v1.0.0", "pre-launch"
  description  TEXT NOT NULL CHECK (length(trim(description)) > 0),               -- decyzja 5
  created_by   TEXT NOT NULL,                                                     -- "user" | "agent"
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  slug         TEXT,
  roots        TEXT
);
CREATE TABLE tag (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX uq_agent_credential_provider ON agent_credential (provider);
CREATE INDEX idx_cbt_thread ON chat_background_task(thread_id);
CREATE INDEX idx_cm_subagent_task ON chat_message(subagent_task_id);
CREATE INDEX idx_cm_thread ON chat_message(thread_id);
CREATE INDEX idx_cm_tool ON chat_message(tool_id);
CREATE INDEX idx_chat_queued_message_thread_pos ON chat_queued_message (thread_id, position);
CREATE INDEX idx_cst_thread ON chat_subagent_task(thread_id);
CREATE INDEX idx_chat_thread_brief_path
  ON chat_thread(brief_path) WHERE brief_path IS NOT NULL;
CREATE INDEX idx_chat_thread_parent_thread_id ON chat_thread(parent_thread_id);
CREATE INDEX idx_chat_thread_patch_path
  ON chat_thread(patch_path) WHERE patch_path IS NOT NULL;
CREATE INDEX idx_chat_thread_plan ON chat_thread(plan_id);
CREATE INDEX idx_chat_thread_plan_path ON chat_thread(plan_path) WHERE plan_path IS NOT NULL;
CREATE INDEX idx_entity_tag_entity   ON entity_tag(entity_type, entity_slug);
CREATE INDEX idx_entity_tag_tag_slug ON entity_tag(tag_slug);
CREATE INDEX idx_entity_version_release ON entity_version(release_id);
CREATE INDEX idx_ev_entity             ON entity_version(entity_type, entity_slug);
CREATE INDEX idx_file_version_path           ON file_version(path);
CREATE INDEX idx_file_version_release        ON file_version(release_id);
CREATE INDEX idx_file_version_root_release   ON file_version(rootId, release_id);
CREATE INDEX idx_pv_plan ON plan_version(plan_id);
CREATE UNIQUE INDEX uq_pv_plan_version ON plan_version(plan_id, version);
CREATE INDEX idx_release_import_local_release ON release_import(local_release_id);
CREATE INDEX idx_release_push_release_id        ON release_push (release_id, pushed_at DESC);
CREATE INDEX idx_release_push_remote_release_id ON release_push (remote_release_id);
CREATE UNIQUE INDEX uq_remote_session_remote_account_id
  ON remote_session(remote_account_id);
CREATE INDEX idx_sel_anchor ON section_entity_link(anchor);
CREATE INDEX idx_sel_entity ON section_entity_link(rootId, entity_type, entity_slug);
CREATE INDEX idx_si_hash ON section_index(content_hash);
CREATE INDEX idx_si_root_page ON section_index(rootId, page_path);
CREATE INDEX idx_spec_release_created_at ON spec_release(created_at DESC);
CREATE UNIQUE INDEX idx_spec_release_slug ON spec_release(slug);

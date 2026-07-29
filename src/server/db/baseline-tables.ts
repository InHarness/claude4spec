/**
 * The tables owned by the core host schema (`000_baseline.sql`).
 *
 * This is the predicate for schema-ownership collision detection: a plugin
 * migration that declares `CREATE TABLE` for one of these is redefining a table
 * it does not own, and is rejected. Note the predicate is "is in the core
 * baseline", NOT "already exists in this database" — an upgraded installation
 * legitimately has `endpoint` from the historical chain, and the module that now
 * owns that type must be allowed to adopt it.
 *
 * Kept honest by `baseline-tables.test.ts`, which executes the baseline and
 * compares. Do not hand-edit one without the other.
 */
export const BASELINE_TABLES: ReadonlySet<string> = new Set([
  '_init_marker',
  'agent_credential',
  'chat_background_task',
  'chat_message',
  'chat_queued_message',
  'chat_subagent_task',
  'chat_thread',
  'database_table',
  'entity_tag',
  'entity_version',
  'file_version',
  'plan',
  'plan_version',
  'release_import',
  'release_push',
  'remote_session',
  'section_entity_link',
  'section_index',
  'spec_release',
  'tag',
]);

/**
 * `database-table` is contributed by an EXTERNAL plugin, but its table predates
 * the plugin split and is still created by the baseline (see the note there).
 * Without this exemption the preinstalled plugin would fail every project build
 * on a collision the host itself caused.
 */
export const COLLISION_EXEMPT_TABLES: ReadonlySet<string> = new Set(['database_table']);

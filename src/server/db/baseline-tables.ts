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

/*
 * 0.2.11: `COLLISION_EXEMPT_TABLES` is gone.
 *
 * It existed to excuse exactly one table, `database_table`, from
 * schema-ownership collision detection -- necessary only because the baseline
 * created a table it did not own. With that `CREATE TABLE` removed from
 * `000_baseline.sql`, the collision it was papering over cannot occur: the
 * module that contributes the type is the only thing that creates its table.
 *
 * There is deliberately no replacement. An exemption list is the mechanism by
 * which a type becomes privileged, which is the thing this release removes.
 */

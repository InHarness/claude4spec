import type { SystemPromptContribution } from '@c4s/plugin-runtime';

/**
 * WHERE THE RETIRED `database-table-tools` SERVER WENT.
 *
 * v1 shipped five domain tools — `create_database_table` and friends — and their
 * real job was not the CRUD (the host does that) but GUARDING it: the type
 * declined the generic `backend.crud` slot so every write had to pass through
 * them. Host API 2.x has no way to decline: `project-context` mounts the
 * generated router for every active type and `entity-tools` reports
 * `crudSupported` unconditionally. Keeping the tools would have left
 * `create_entities` / `update_entities` as an unguarded second door, which is
 * worse than no door — so the tools are gone and the rules they enforced are
 * stated here instead.
 *
 * That trade is only sound because the rules that can be MECHANICAL now are:
 * the identifier shape and the reserved-word screen are one named validator,
 * `kind: 'sql-identifier'` on `title`, enforced by the generated schema on every
 * write through every door. What is left here is the part no validator can
 * express — what a soft FK MEANS, and that a rename is not a `title` edit.
 */
export const databaseTableSystemPrompt: SystemPromptContribution = {
  roleNoun: 'database tables',
  /**
   * 0.2.50 — the sentence defending `title` as an SQL identifier went.
   * `constraints` publishes `kind: 'sql-identifier'` for that field WITH its own
   * prose, and `describe_entity_type` returns it, so the prompt was paraphrasing
   * a rule the host states better and enforces itself.
   *
   * What stays is what the schema cannot say: that this type is a SHAPE and
   * nothing runs DDL, that a soft `fk` is PERMISSION to reference forward, and
   * that renaming goes through `newSlug` rather than `title`.
   */
  narrativeBlock:
    'A database table is a SHAPE — ordered columns and indexes — not a live schema; nothing here ' +
    'runs DDL. A column\'s `fk` is a SOFT foreign key: it may point at a table that does not exist ' +
    'yet, which returns a warning rather than an error, and deleting a table never cascades to the ' +
    'columns referencing it — so you may reference a table you have not written. The slug is derived ' +
    'from `title` once, so editing `title` alone does NOT rename the entity: pass `newSlug` to do ' +
    'that, which also repoints every `fk` pointing here.',
};

import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

export const acSystemPrompt: SystemPromptContribution = {
  roleNoun: 'Acceptance criteria',
  /**
   * The predicate 0.2.4 dropped, restored as data. `ac` is the only built-in
   * type that ever counted a subset: the agent saw `status='active'` while the
   * sidebar counted every row, and deprecating that SQL silently made the agent
   * agree with the sidebar rather than the other way round.
   *
   * 2.0.0 tier K — this line is now the ONLY place "an AC list means the active
   * ones" is written down. `AcService.list` defaulted `status` to `'active'` in
   * hand-written SQL and is deleted; the declaration carries the same rule to
   * the count, the list, the REST route and the MCP tool at once. A caller that
   * wants the rest asks for it: `filters: { status: ['active','deprecated'] }`.
   */
  defaultPredicate: { field: 'status', in: ['active'] },
  // M13: CRUD moved to the generic entity-tools server (composed by the host);
  // this line now covers ONLY ac's custom semantic-audit tool.
  mcpToolsLine: 'ac-tools: analyze_ac_against_entities',
  /**
   * 0.2.50 — the tagging convention (`mNN` / `mNN-edge` / `entity-{type}` / `lN`)
   * used to ride here, on the argument that an agent which has to read a page to
   * learn how to tag will tag inconsistently on the turn it creates the
   * criterion. The argument is sound and the address was wrong: those tokens
   * describe ONE project's module numbering ("Layered Vertical Slices"), not a
   * property of the `ac` type, and every other installation was being handed
   * them as a fact about the product. A convention that varies per project
   * belongs to the project's active writing style, which the agent loads with
   * `load_skill_file` in every context type — early enough to tag correctly on
   * the same turn.
   *
   * 0.2.50 — the field list went with it, for the same reason one step further
   * out: `kind`, `status` and `verifies[]` are named in `createSchema` and
   * their enums appear twice more in `constraints`, all of it returned by
   * `describe_entity_type` and derived from the schema the host enforces.
   *
   * What stays is the granulation rule — one observable statement, which is a
   * decision about how many criteria to write, not a field — and the tag
   * convention, which no schema can carry because it varies per project.
   */
  narrativeBlock:
    'Acceptance criteria state ONE observable thing each: if a criterion needs an "and" to be true, it is two criteria. ' +
    'The tag vocabulary is a project convention, not a property of the type: follow the active writing style, and reuse the tags already on neighbouring criteria rather than inventing a scheme.',
};

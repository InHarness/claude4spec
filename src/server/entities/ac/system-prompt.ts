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
   * The tagging convention rides HERE rather than in the specification, because
   * an agent that has to read a page to learn how to tag will tag inconsistently
   * on the turn it creates the criterion. `tags` is the classification axis for
   * consistency rules 10 and 11, so a wrong tag is not cosmetic — it decides
   * whether a module counts as covered.
   */
  narrativeBlock:
    'Acceptance criteria — one observable statement; kind (requirement/edge-case), status (active/deprecated), verifies[] refs to entities, tags. ' +
    'Tagging convention: a host module is `mNN` (m16, m05); its edge cases take the sibling tag `mNN-edge`; ' +
    'an entity type contributed by a plugin is `entity-{type}` (entity-dto, entity-diagram); ' +
    'a layer criterion is `lN` (l9) and is embedded on the page of the module that implements the layer, not on the layer page.',
};

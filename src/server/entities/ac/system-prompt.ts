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
  narrativeBlock:
    'Acceptance criteria — one observable statement; kind (requirement/edge-case), status (active/deprecated), verifies[] refs to entities, tags.',
};

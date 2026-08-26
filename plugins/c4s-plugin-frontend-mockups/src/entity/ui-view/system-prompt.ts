import type { SystemPromptContribution } from '@c4s/plugin-runtime';

export const uiViewSystemPrompt: SystemPromptContribution = {
  roleNoun: 'UI views',
  // M13: CRUD moved to the generic entity-tools server (composed by the host);
  // ui-view has no custom (non-CRUD) tools, so mcpToolsLine is omitted.
  /**
   * 0.2.50 — the field enumeration went; the two facts that change what the
   * agent DOES stayed: that the default screen state is not an entry (so an
   * empty `states` means one state, not none), and that `mockupHtml` is
   * content-bearing, which is the only reason a read of a ui-view can come back
   * looking empty.
   */
  /**
   * 0.2.50 — the `mockupHtml` sentence went: it restated `contentFields`, which
   * `describe_entity_type` returns as `{ field, operation }` pairs, naming the
   * very tool that issues the content.
   *
   * The `states` semantics stay. The schema says `states` is a list; it cannot
   * say that the DEFAULT screen is not one of its entries, so an empty list
   * means one state rather than zero — a reading no field description supplies.
   */
  narrativeBlock:
    'UI views are screen-level. `states` lists the ALTERNATIVE screens (empty, loading, error): the ' +
    'default state is not an entry, so an empty list means ONE state rather than none.',
};

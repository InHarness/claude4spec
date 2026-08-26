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
  narrativeBlock:
    'UI views are screen-level: a url with its params, plus `states` for the ALTERNATIVE screens ' +
    '(empty, loading, error) — the default state is not an entry, so an empty list means one ' +
    'state rather than none. `mockupHtml` is content-bearing: an ordinary read never emits it, ' +
    'and `get_field_content` is the only way to see it.',
};

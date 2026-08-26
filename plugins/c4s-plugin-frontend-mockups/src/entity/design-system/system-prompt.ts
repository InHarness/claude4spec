import type { SystemPromptContribution } from '@c4s/plugin-runtime';

export const designSystemSystemPrompt: SystemPromptContribution = {
  roleNoun: 'Design Systems',
  // M13: CRUD moved to the generic entity-tools server (composed by the host);
  // design-system has no custom (non-CRUD) tools, so this contribution omits
  // mcpToolsLine entirely (optional field).
  /**
   * 0.2.50 — the list of token categories and theme modes went; both are in the
   * schema `describe_entity_type` returns. `{token}` stays because it is a
   * convention about a VALUE, not a field: nothing in the schema says a semantic
   * token aliases a primitive by writing its name in braces.
   */
  narrativeBlock:
    'Design Systems hold named tokens in two tiers: a semantic token takes `{token}` as its VALUE to ' +
    'alias a primitive, rather than repeating the literal. A ui-view points at a design system through ' +
    'the structural `designSystemSlug` field, never through tags.',
};

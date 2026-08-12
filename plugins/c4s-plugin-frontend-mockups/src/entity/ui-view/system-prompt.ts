import type { SystemPromptContribution } from '@c4s/plugin-runtime';

export const uiViewSystemPrompt: SystemPromptContribution = {
  roleNoun: 'UI views',
  // M13: CRUD moved to the generic entity-tools server (composed by the host);
  // ui-view has no custom (non-CRUD) tools, so mcpToolsLine is omitted.
  narrativeBlock:
    'UI views (screen-level) — name, url, params (path/query/hash), tags.',
};

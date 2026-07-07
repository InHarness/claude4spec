import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

export const uiViewSystemPrompt: SystemPromptContribution = {
  roleNoun: 'UI views',
  countStat: {
    placeholder: 'uiViewCount',
    sqlQuery: 'SELECT COUNT(*) AS count FROM ui_view',
    label: 'ui-views',
  },
  // M13: CRUD moved to the generic entity-tools server (composed by the host);
  // ui-view has no custom (non-CRUD) tools, so mcpToolsLine is omitted.
  narrativeBlock:
    'UI views (screen-level) — name, url, params (path/query/hash), tags.',
};

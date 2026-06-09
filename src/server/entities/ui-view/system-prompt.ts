import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

export const uiViewSystemPrompt: SystemPromptContribution = {
  roleNoun: 'UI views',
  countStat: {
    placeholder: 'uiViewCount',
    sqlQuery: 'SELECT COUNT(*) AS count FROM ui_view',
    label: 'ui-views',
  },
  mcpToolsLine:
    'ui-view-tools: create_ui_view, get_ui_view, update_ui_view, delete_ui_view, list_ui_views',
  narrativeBlock:
    'UI views (screen-level) — name, url, params (path/query/hash), tags.',
};

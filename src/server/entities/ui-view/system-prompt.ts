import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

/**
 * UI views are intentionally absent from the chat system prompt today (legacy
 * behavior). Empty roleNoun signals opt-out — buildSystemPrompt skips this
 * plugin's contribution.
 */
export const uiViewSystemPrompt: SystemPromptContribution = {
  roleNoun: '',
  countStat: {
    placeholder: 'uiViewCount',
    sqlQuery: 'SELECT COUNT(*) AS count FROM ui_view',
    label: 'ui-views',
  },
  mcpToolsLine: '',
};

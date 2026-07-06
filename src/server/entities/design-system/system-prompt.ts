import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

export const designSystemSystemPrompt: SystemPromptContribution = {
  roleNoun: 'Design Systems',
  countStat: {
    placeholder: 'designSystemCount',
    sqlQuery: 'SELECT COUNT(*) AS count FROM design_system',
    label: 'design-systems',
  },
  mcpToolsLine:
    'design-system-tools: create_design_system, get_design_system, update_design_system, delete_design_system, list_design_systems',
  narrativeBlock:
    'Design Systems describe named token sets (colors, typography, spacing, ...) in a two-tier model ' +
    '(primitive → semantic) with `{token}` aliases and optional theme modes. A ui-view points at a design ' +
    'system via the structural `designSystemSlug` field (not tags).',
};

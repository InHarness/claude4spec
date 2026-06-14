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
    'Design systems — named sets of design tokens in a two-tier model (primitive raw scales → semantic roles). ' +
    'Token values are literals ("#2563eb", "16px"), `{token}` aliases to other tokens, or composite objects ' +
    '(typography/shadow). Optional theme modes override tokens (Base = no overrides). groups/modes are embedded ' +
    'JSON (no junction tables). A ui-view may reference one design-system via its scalar `designSystemSlug` field ' +
    '(the first structural, non-tag relation).',
};

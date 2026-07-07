import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

export const designSystemSystemPrompt: SystemPromptContribution = {
  roleNoun: 'Design Systems',
  countStat: {
    placeholder: 'designSystemCount',
    sqlQuery: 'SELECT COUNT(*) AS count FROM design_system',
    label: 'design-systems',
  },
  // M13: CRUD moved to the generic entity-tools server (composed by the host);
  // design-system has no custom (non-CRUD) tools, so this contribution omits
  // mcpToolsLine entirely (optional field).
  narrativeBlock:
    'Design Systems describe named token sets (colors, typography, spacing, ...) in a two-tier model ' +
    '(primitive → semantic) with `{token}` aliases and optional theme modes. A ui-view points at a design ' +
    'system via the structural `designSystemSlug` field (not tags).',
};

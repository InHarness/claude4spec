import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

export const acSystemPrompt: SystemPromptContribution = {
  roleNoun: 'Acceptance criteria',
  countStat: {
    placeholder: 'acCount',
    sqlQuery: "SELECT COUNT(*) AS count FROM ac WHERE status='active'",
    label: 'AC (active)',
  },
  mcpToolsLine:
    'ac-tools: create_ac, get_ac, update_ac, delete_ac, list_acs',
  narrativeBlock:
    'Acceptance criteria — one observable statement; kind (requirement/edge-case), status (active/deprecated), verifies[] refs to entities, tags.',
};

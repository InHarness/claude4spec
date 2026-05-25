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
  narrativeBlock: [
    'Create AC when a module or feature has observable behavior to verify.',
    'Tagging convention: module MNN AC → tag "mNN"; entity X AC → tag "entity-X";',
    'project-level AC → no module/entity tag, classification tags only.',
    'If an AC concerns a specific endpoint/DTO/UI view, fill the verifies field —',
    'M19 checks referential integrity. kind="edge-case" for boundary conditions.',
    'Prefer status="deprecated" over hard delete — it preserves history and references.',
  ].join(' '),
};

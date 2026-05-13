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
    'Twórz AC gdy moduł lub feature ma observable behavior do sprawdzenia.',
    'Konwencja tagowania: AC modułu MNN → tag "mNN"; AC encji X → tag "entity-X";',
    'project-level AC → brak module/entity tagu, tylko klasyfikacyjne.',
    'Jeśli AC dotyczy konkretnego endpointa/DTO/UI view, wypełnij pole verifies —',
    'M19 sprawdzi referential integrity. kind="edge-case" dla warunków brzegowych.',
    'Preferuj status="deprecated" nad hard delete — zachowuje historię i referencje.',
  ].join(' '),
};

import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

export const dtoSystemPrompt: SystemPromptContribution = {
  roleNoun: 'DTOs',
  countStat: {
    placeholder: 'dtoCount',
    sqlQuery: 'SELECT COUNT(*) AS count FROM dto',
    label: 'dtos',
  },
  narrativeBlock:
    'Data Transfer Objects — named field schemas (name, type, required, description), examples, linked endpoints, tags.',
};

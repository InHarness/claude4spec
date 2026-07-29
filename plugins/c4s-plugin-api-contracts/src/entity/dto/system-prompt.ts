import type { SystemPromptContribution } from '@c4s/plugin-runtime';

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

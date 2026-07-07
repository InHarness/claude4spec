import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

export const endpointSystemPrompt: SystemPromptContribution = {
  roleNoun: 'Endpoints',
  countStat: {
    placeholder: 'endpointCount',
    sqlQuery: 'SELECT COUNT(*) AS count FROM endpoint',
    label: 'endpoints',
  },
  // M13: CRUD moved to the generic entity-tools server (composed by the host);
  // this line now covers ONLY endpoint's custom relation tools.
  mcpToolsLine: 'endpoint-tools: link_dto, unlink_dto',
  narrativeBlock:
    'REST endpoints — method, path, summary, linked request/response/error DTOs, tags.',
};

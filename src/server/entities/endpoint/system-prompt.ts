import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

export const endpointSystemPrompt: SystemPromptContribution = {
  roleNoun: 'Endpoints',
  countStat: {
    placeholder: 'endpointCount',
    sqlQuery: 'SELECT COUNT(*) AS count FROM endpoint',
    label: 'endpoints',
  },
  mcpToolsLine:
    'endpoint-tools: create_endpoint, get_endpoint, update_endpoint, delete_endpoint, list_endpoints, link_dto, unlink_dto',
  narrativeBlock:
    'REST endpoints — method, path, summary, linked request/response/error DTOs, tags.',
};

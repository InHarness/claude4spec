import type { SystemPromptContribution } from '@c4s/plugin-runtime';

export const endpointSystemPrompt: SystemPromptContribution = {
  roleNoun: 'Endpoints',
  // M13: CRUD moved to the generic entity-tools server (composed by the host);
  // this line now covers ONLY endpoint's custom relation tools.
  mcpToolsLine: 'endpoint-tools: link_dto, unlink_dto',
  // 0.2.50: the field list went (see the note on `dto`); the request/response/
  // error DISTINCTION stayed, because it is the part `link_dto` needs from the
  // author and cannot infer.
  narrativeBlock:
    'REST endpoints — method and path, with DTOs linked in three distinct roles (request, ' +
    'response, error) through `link_dto` rather than named in prose.',
};

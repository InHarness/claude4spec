import type { SystemPromptContribution } from '@c4s/plugin-runtime';

export const dtoSystemPrompt: SystemPromptContribution = {
  roleNoun: 'DTOs',
  /**
   * 0.2.50 — the field enumeration went; the RELATION stayed.
   *
   * "name, type, required, description" cannot be written from: it carries no
   * types, no requiredness and no validators, so authoring a DTO needs
   * `describe_entity_type` regardless — the list was a preview of a schema the
   * agent has to fetch anyway. What it is NOT derivable from that schema is the
   * structural link to endpoints, which is what makes a DTO worth looking up.
   */
  narrativeBlock:
    'Data Transfer Objects — named field schemas, structurally linked to the endpoints that carry ' +
    'them, so `find_references` on a DTO reaches its endpoints and not only the pages naming it.',
};

import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

export const diagramSystemPrompt: SystemPromptContribution = {
  roleNoun: 'Diagrams',
  // M13: CRUD moved to the generic entity-tools server (composed by the host);
  // this line now covers ONLY diagram's custom pre-flight validation tool.
  mcpToolsLine: 'diagram-tools: validate_diagram',
  narrativeBlock:
    'Diagrams are hoisted out to entities — the DSL body (Mermaid) lives in the entity file, not the page. ' +
    'Embed only via the generic reference `<single_element type="diagram" slug="…" caption="…"/>` (block) or ' +
    '`<inline_mention type="diagram" slug="…"/>` (chip) — do NOT paste the DSL into the page; full referencing ' +
    'instructions live in the `<diagram_references>` block.',
};

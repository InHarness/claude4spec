import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

export const diagramSystemPrompt: SystemPromptContribution = {
  roleNoun: 'Diagrams',
  countStat: {
    placeholder: 'diagramCount',
    sqlQuery: 'SELECT COUNT(*) AS count FROM diagram',
    label: 'diagrams',
  },
  mcpToolsLine:
    'diagram-tools: create_diagram, get_diagram, update_diagram, delete_diagram, list_diagrams',
  narrativeBlock:
    'Diagrams are hoisted out to entities — the DSL body (Mermaid) lives in the entity file, not the page. ' +
    'Embed only via the self-closing reference `<diagram slug="…" caption="…"/>` — do NOT paste the DSL into ' +
    'the page; full referencing instructions live in the `<diagram_references>` block.',
};

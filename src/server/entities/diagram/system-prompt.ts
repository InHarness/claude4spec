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
    'Diagrams — reusable diagram entities whose DSL `source` (mermaid; `d2` is a reserved slot) is the source ' +
    'of truth. A page references a diagram with a self-closing `<diagram slug="…" caption="…"/>` tag; `caption` ' +
    'is a per-reference attribute (so the same diagram can carry different captions in different places) and is ' +
    'NOT stored on the entity. Diagram is a graph leaf — no junction tables, references no other entity. `source` ' +
    'may be empty (placeholder); it is validated with mermaid.parse() producing warnings only (never blocks).',
};

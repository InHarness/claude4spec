import type { SystemPromptContribution } from '../../../shared/plugin-host/types.js';

/**
 * 0.2.50 — the referencing convention moved HERE, from a hardcoded
 * `<diagram_references>` block in `chat-context.ts`. Two things were wrong with
 * the old home: the core builder emitted it unconditionally, so a project
 * without the `diagram` type still got a page of instructions for embedding
 * diagrams; and the convention was written twice, once in that block and once
 * in the `narrativeBlock` below, which ended by pointing at its own duplicate.
 * A type owns the grammar for writing about it, and the grammar travels with the
 * type through `promptBlocks`.
 */
const DIAGRAM_REFERENCES = `<diagram_references>
  <single_element type="diagram" slug="..." caption="..."/>
  <inline_mention type="diagram" slug="..."/>
A \`diagram\` is embedded with the GENERIC reference tags, like every other entity type. The Mermaid DSL \`source\` is the entity's truth (stored in \`.claude4spec/entities/diagram/<slug>.json\`), NOT inline in the page. The page tag carries \`type\`, \`slug\` (which diagram) and an optional \`caption\` — caption is per-reference prose, so the same diagram can show different captions in different places. Tiptap fetches the source by slug and renders it live, with a fallback \`<pre>\` on parse error. Create and edit diagrams through the generic \`entity-tools\` CRUD; \`diagram-tools\` keeps only \`validate_diagram\` (DSL pre-flight). Insertable via slash command \`/diagram\` (authors the source, creates the entity, inserts the reference) in page and plan editors.

\`diagram\` is a HIDDEN type: it has no sidebar tab and no detail page, so \`<element_list type="diagram" .../>\` and \`<tagged_list type="diagram" .../>\` are NOT supported — embed diagrams one at a time.

Example:
  <single_element type="diagram" slug="auth-flow" caption="Auth flow"/>
</diagram_references>`;

export const diagramSystemPrompt: SystemPromptContribution = {
  roleNoun: 'Diagrams',
  // M13: CRUD moved to the generic entity-tools server (composed by the host);
  // this line now covers ONLY diagram's custom pre-flight validation tool.
  mcpToolsLine: 'diagram-tools: validate_diagram',
  narrativeBlock:
    'Diagrams are hoisted out to entities — the DSL body (Mermaid) lives in the entity file, not the page. ' +
    'Embed only via the generic reference `<single_element type="diagram" slug="…" caption="…"/>` (block) or ' +
    '`<inline_mention type="diagram" slug="…"/>` (chip) — do NOT paste the DSL into the page.',
  promptBlocks: [{ name: 'diagram_references', body: DIAGRAM_REFERENCES }],
};

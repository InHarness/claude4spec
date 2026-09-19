import type { ProjectPluginHost } from '../../../core/plugin-host/types.js';
import type { PromptBlock } from '../types.js';

/* M13 — Entity Framework: the catalogue of active entity types, and the whole
 * blocks those types contribute (`SystemPromptContribution.promptBlocks`). */

function buildEntityRows(pluginHost: ProjectPluginHost): string {
  // Each active plugin contributes one <entity> row; empty roleNoun = opt-out
  // (legacy ui-view behaviour). Row body uses narrativeBlock when present,
  // otherwise falls back to the plural roleNoun.
  const rows: string[] = [];
  for (const m of pluginHost.listEntities()) {
    if (!m.systemPrompt.roleNoun) continue;
    const body = m.systemPrompt.narrativeBlock ?? m.systemPrompt.roleNoun;
    rows.push(`  <entity type="${m.type}">${body}</entity>`);
  }
  // rows.push('  <entity name="tag">Cross-cutting categorization (color, slug)</entity>');
  return rows.join('\n');
}

/**
 * 0.2.50 — the rows state RULES; the closing line says where the SHAPES are.
 *
 * Every row used to open by enumerating the type's fields, its enums and which
 * read carries its content. All of that is what `describe_entity_type` returns,
 * and it returns it DERIVED from the declared data schema — so the tool's answer
 * cannot drift from what the host enforces, while a hand-written preview of it
 * can and did. Naming the tool once costs a line and is always current; the
 * rows keep only what the tool does not answer: when to reach for the type, and
 * the conventions no validator enforces.
 */
function buildEntitiesBlock(pluginHost: ProjectPluginHost): string {
  const schemaPointer =
    '  Call describe_entity_type(type) for a type\'s fields, enums, required-ness and which reads ' +
    'carry which — before your first write of a type. The rows above state RULES, not shapes.\n' +
    '  Record counts are not in this prompt: call list_entities({ type, mode: "count" }) when you need one — it stays current after your own writes mid-turn.';
  return `<entities>\n${buildEntityRows(pluginHost)}\n${schemaPointer}\n</entities>`;
}

export const M13_PROMPT_BLOCKS: readonly PromptBlock[] = [
  { name: 'entities', render: (c) => buildEntitiesBlock(c.host) },
  /**
   * Blocks contributed by the ACTIVE entity types, in `listEntities()` order.
   * `<diagram_references>` is the first migrant: it used to be hardcoded in the
   * composer and emitted even for projects with no `diagram` type mounted.
   */
  {
    name: 'plugin_prompt_blocks',
    render: (c) => {
      const blocks: string[] = [];
      for (const m of c.host.listEntities()) {
        for (const b of m.systemPrompt.promptBlocks ?? []) blocks.push(b.body);
      }
      return blocks.length > 0 ? blocks.join('\n\n') : null;
    },
  },
];

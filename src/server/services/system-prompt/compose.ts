import { joinBlocks } from './glue.js';
import { PROMPT_BLOCKS } from './registry.js';
import type { CompositionEntry, PromptContext, SystemPromptInput } from './types.js';

/**
 * M48 — the composer. Takes a composition (which blocks, in which order, with
 * which per-position options), looks each block up by name among the modules'
 * declarations, renders it against the turn's context and glues the result.
 *
 * It reads none of the text it glues: a block's content is opaque here, and a
 * block whose emission condition does not hold renders `null` and leaves no gap.
 * A composition naming a block nobody declares is a programming error, not an
 * empty block.
 */
export function composeSystemPrompt(
  composition: readonly CompositionEntry[],
  input: SystemPromptInput,
): string {
  const ctx: PromptContext = {
    ...input,
    contextType: input.contextType ?? 'chat',
    annotations: input.annotations ?? [],
    availableSkills: input.availableSkills ?? [],
    mcpInventory: input.mcpInventory ?? [],
    workspaceProjects: input.workspaceProjects ?? [],
    currentPageRootId: input.currentPageRootId ?? 'pages',
    planMode: input.planMode ?? false,
    currentPlan: input.currentPlan ?? null,
    writingStyleSkill: input.writingStyleSkill ?? null,
    brief: input.brief ?? null,
    patch: input.patch ?? null,
  };
  return joinBlocks(
    composition.map((entry) => {
      const block = PROMPT_BLOCKS.get(entry.block);
      if (!block) throw new Error(`composition names an undeclared prompt block <${entry.block}>`);
      return block.render(ctx, entry.options);
    }),
  );
}

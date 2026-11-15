import type { ChatContextType } from '../../../../shared/entities.js';
import { attrs, selfClose } from '../glue.js';
import type { PromptBlock } from '../types.js';

/* M44 — Context Types: the frame of `<interaction_context>`. Its body is owned
 * by the genre's module (M21/M23/M11) and reaches it through the registry's
 * `interactionRules` (see `interaction-rules.ts`). */

/**
 * 0.2.19 / 2.1.88: `<interaction_context type="{wartość rejestru typów kontekstu projektu}">`
 * (`szablon-interaction-context-rama`) — the domain rules of the thread's interaction type.
 * `type` is the thread's value of the project's context-type registry, whichever row it
 * is. Emitted UNCONDITIONALLY, exactly once, as the first block of every composition —
 * ahead of `<claude4spec_identity>` in the default one; in the brief one, where it replaced
 * `<claude4spec_brief_identity>` + `<self_contained_invariant>`, it stands in for the
 * identity altogether.
 *
 * With no rules the block still renders, self-closing with just its `type`. That is not a
 * degenerate case to tidy away: an absent block is indistinguishable from "this host has
 * no such concept", whereas `<interaction_context type="chat"/>` says the concept exists
 * and this type carries no extra rules. The `type` attribute alone is worth emitting — it
 * tells the agent which interaction it is in.
 *
 * The body is verbatim from the row's `Reguły domenowe` (owned by the contributing module);
 * this function deliberately contains no genre text of its own.
 */
function buildInteractionContext(contextType: ChatContextType, interactionRules?: string): string {
  const body = (interactionRules ?? '').trim();
  if (body === '') return selfClose('interaction_context', attrs({ type: contextType }));
  return [`<interaction_context ${attrs({ type: contextType })}>`, body, `</interaction_context>`].join('\n');
}

export const M44_PROMPT_BLOCKS: readonly PromptBlock[] = [
  { name: 'interaction_context', render: (c) => buildInteractionContext(c.contextType, c.interactionRules) },
];

import { attrs } from '../glue.js';
import type { PromptBlock } from '../types.js';

/* M10 — Plans: the plan pinned to the thread. The operations on it reach the
 * model through their own descriptions; there is no usage block (0.2.50). */

export const M10_PROMPT_BLOCKS: readonly PromptBlock[] = [
  {
    name: 'current_plan',
    render: (c) => {
      if (!c.currentPlan) return null;
      /**
       * 0.2.105 — the block is the plan's ADDRESS and version, never its body
       * and never its hash.
       *
       * Up to 0.2.104 it inlined the whole plan plus the file's hash, so a first
       * `update_plan` could go out without a read — except on a plan the prompt
       * budget had truncated, where the hash had to be withheld and a warning
       * took its place. Both halves were a liability: the body duplicated bytes
       * the agent fetched anyway, and a hash without its content is an
       * invitation to write blind. `get_plan` is now the first and only way in,
       * and `expectedHash` comes from it. Pinned is the whole condition — the
       * content is no longer a criterion of anything, an empty plan included.
       */
      return `<current_plan ${attrs({
        path: c.currentPlan.path,
        version: c.currentPlan.currentVersion,
      })}>\nThe plan's content is NOT in this prompt — read it with get_plan.\n</current_plan>`;
    },
  },
];

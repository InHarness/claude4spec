import { attrs } from '../glue.js';
import type { PromptBlock } from '../types.js';

/* M10 — Plans: the plan pinned to the thread. The operations on it reach the
 * model through their own descriptions; there is no usage block (0.2.50). */

export const M10_PROMPT_BLOCKS: readonly PromptBlock[] = [
  {
    name: 'current_plan',
    render: (c) => {
      if (!c.currentPlan || c.currentPlan.body.trim().length === 0) return null;
      /**
       * 0.2.50 — `hash` and `path` join `version`, and the omission they fix was
       * expensive out of all proportion to its size.
       *
       * The block injects the plan's ENTIRE body — some 25 KB in a real thread.
       * To change one line of it the agent calls `update_plan`, which REQUIRES
       * `expectedHash` on every call after the one that creates the plan, and
       * the only source of a hash was `get_plan`. So the agent called
       * `get_plan`, received the same 25 KB a second time, and only then could
       * write. The injection saved no call; it doubled one.
       *
       * `get_plan`'s own doc comment states the principle this block was
       * breaking: "a read operation that cannot arm the write operation's guard
       * leaves the caller no legal first move." `<current_plan>` was exactly
       * such a read, and the hash was in the same object the whole time.
       */
      /**
       * ...but ONLY on a whole plan. `getByThread` reads through `getByPath`,
       * which windows the file at half the response budget, and `hash` is the
       * digest of the WHOLE file either way — so on a truncated read the hash
       * arms `expectedHash` against bytes the block never showed. The guard then
       * passes on a body composed from the visible part, and the plan loses its
       * tail with a `file_version` row asserting the edit was the change.
       * `readForWrite`'s doc comment describes exactly this, which is why that
       * second read exists at all.
       *
       * A truncated block therefore withholds the hash instead of handing over
       * a loaded one, and says why. That restores the extra `get_plan` call in
       * the one case where the call is not redundant.
       */
      const truncated = c.currentPlan.truncated === true;
      const block = `<current_plan ${attrs({
        path: c.currentPlan.path,
        version: c.currentPlan.currentVersion,
        hash: truncated ? undefined : c.currentPlan.hash,
        truncated: truncated ? 'true' : undefined,
      })}>\n${c.currentPlan.body}\n</current_plan>`;
      if (!truncated) return block;
      return (
        `${block}\n` +
        `This plan was TRUNCATED to fit the prompt${c.currentPlan.truncationHint ? ` (${c.currentPlan.truncationHint})` : ''} — the body above is not the whole file, and no hash is given for it. ` +
        `Do NOT compose an update from what you see here: read the plan with get_plan first and write against the hash it returns, or you will write the truncation back over the missing part.`
      );
    },
  },
];

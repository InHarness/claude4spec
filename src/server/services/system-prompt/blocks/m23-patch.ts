import type { PatchDetail } from '../../patch.js';
import { attrs } from '../glue.js';
import type { PromptBlock } from '../types.js';

/* M23 — Patches (body and genre attributes) with M36 — Chat Artifacts (the
 * carrier frame): the patch pinned to a patch-resolution thread. */

/**
 * M23: patch snapshot block for a patch-resolution thread. Mirrors
 * `<current_brief>` — full file content verbatim plus a directive framing the
 * task (apply the patch's findings to the spec).
 */
function buildCurrentPatch(patch: PatchDetail): string {
  const fm = patch.frontmatter;
  return [
    `<current_patch ${attrs({
      path: patch.path,
      patch_kind: String(fm.patch_kind ?? ''),
      // 0.2.14: was `status="awaiting|completed"`. A missing key reads `false`,
      // and so does a legacy `status: completed` — that key is unknown now.
      applied: String(fm.applied === true),
      brief: typeof fm.brief === 'string' ? fm.brief : undefined,
      hash: patch.hash,
    })}>`,
    `This thread exists to resolve the patch below — a coding agent in another`,
    `terminal filed it as feedback while implementing a brief. Read it, then`,
    `apply its findings to the specification (edit the relevant pages/entities).`,
    `\`applied\` says whether this patch was already folded into the spec once —`,
    `it is a signal to read, not a flag you set: nothing in this thread can`,
    `change it, and only the user flips it from the patch page.`,
    ``,
    patch.content,
    `</current_patch>`,
  ].join('\n');
}

export const M23_PROMPT_BLOCKS: readonly PromptBlock[] = [
  {
    name: 'current_patch',
    render: (c) => (c.contextType === 'patch' && c.patch ? buildCurrentPatch(c.patch) : null),
  },
];

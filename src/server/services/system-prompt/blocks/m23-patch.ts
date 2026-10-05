import type { PatchDetail } from '../../patch.js';
import { attrs } from '../glue.js';
import type { PromptBlock } from '../types.js';

/* M23 — Patches (body and genre attributes) with M36 — Chat Artifacts (the
 * carrier frame): the patch pinned to a patch-resolution thread. */

/**
 * M23: the patch block of a patch-resolution thread. The carrier frame (M36)
 * brings ONLY the artifact's address; the genre (M23) adds its frontmatter
 * attributes and the posture prose. 2.1.4: neither the content nor the hash —
 * those are `get_patch`'s (`patch-tools`), exactly as `<current_brief>` points
 * at `get_brief`.
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
    })}>`,
    `This thread exists to resolve the patch at \`path\` — a coding agent in another`,
    `terminal filed it as feedback while implementing a brief. Its content is NOT`,
    `in this prompt — read it with get_patch, then apply its findings to the`,
    `specification (edit the relevant pages/entities).`,
    `\`applied\` says whether this patch was already folded into the spec once.`,
    `</current_patch>`,
  ].join('\n');
}

export const M23_PROMPT_BLOCKS: readonly PromptBlock[] = [
  {
    name: 'current_patch',
    render: (c) => (c.contextType === 'patch' && c.patch ? buildCurrentPatch(c.patch) : null),
  },
];

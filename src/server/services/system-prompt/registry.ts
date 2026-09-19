import { M01_PROMPT_BLOCKS } from './blocks/m01-language.js';
import { M02_PROMPT_BLOCKS } from './blocks/m02-current-page.js';
import { M05_PROMPT_BLOCKS } from './blocks/m05-agent-scope.js';
import { M10_PROMPT_BLOCKS } from './blocks/m10-plan.js';
import { M13_PROMPT_BLOCKS } from './blocks/m13-entities.js';
import { M15_PROMPT_BLOCKS } from './blocks/m15-writing-style.js';
import { M21_PROMPT_BLOCKS } from './blocks/m21-brief.js';
import { M23_PROMPT_BLOCKS } from './blocks/m23-patch.js';
import { M31_PROMPT_BLOCKS } from './blocks/m31-workspace.js';
import { M37_PROMPT_BLOCKS } from './blocks/m37-skills.js';
import { M44_PROMPT_BLOCKS } from './blocks/m44-interaction-context.js';
import { M48_PROMPT_BLOCKS } from './blocks/m48-own.js';
import type { PromptBlock } from './types.js';

/**
 * M48 — every block a composition can name, keyed by tag.
 *
 * This is NOT a list of the prompt. It is the union of what the modules declare
 * (L16): each module exports its own blocks next to the text they render, and
 * this map only indexes them so a composition can reach a block by name. Which
 * blocks a prompt carries, and in what order, is the composition's business —
 * the default one in `compositions/default.ts`, a context type's own beside it.
 *
 * A tag declared twice is a specification error the composer cannot settle, so
 * it fails at load rather than letting the later declaration win silently.
 */
const DECLARATIONS: readonly (readonly PromptBlock[])[] = [
  M01_PROMPT_BLOCKS,
  M02_PROMPT_BLOCKS,
  M05_PROMPT_BLOCKS,
  M10_PROMPT_BLOCKS,
  M13_PROMPT_BLOCKS,
  M15_PROMPT_BLOCKS,
  M21_PROMPT_BLOCKS,
  M23_PROMPT_BLOCKS,
  M31_PROMPT_BLOCKS,
  M37_PROMPT_BLOCKS,
  M44_PROMPT_BLOCKS,
  M48_PROMPT_BLOCKS,
];

function index(declarations: readonly (readonly PromptBlock[])[]): ReadonlyMap<string, PromptBlock> {
  const map = new Map<string, PromptBlock>();
  for (const blocks of declarations) {
    for (const block of blocks) {
      if (map.has(block.name)) throw new Error(`prompt block <${block.name}> is declared twice`);
      map.set(block.name, block);
    }
  }
  return map;
}

export const PROMPT_BLOCKS: ReadonlyMap<string, PromptBlock> = index(DECLARATIONS);

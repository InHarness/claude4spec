import type { CompositionEntry } from '../types.js';

/**
 * M48 — the DEFAULT composition: the prompt of every context type that declares
 * `promptComposition: 'default'` (today `chat`, `patch`, `ask`). In it, whether a
 * block is present is decided by that block's own emission condition alone.
 *
 * THE ORDER, as data. 0.2.50 replaced seventeen `parts.push(…)` calls, whose
 * sequence recorded when each block was added, with a list that can be read in
 * one screen, asserted in one test, and argued with. 0.2.97 moved the list here,
 * away from the blocks: a module declares WHAT it contributes, the composer
 * decides WHERE it stands — the one property no contributor could write down,
 * because it follows from the relations between blocks, not from any one of them.
 *
 * Two placements are worth defending because they look wrong:
 *
 *   `<interaction_context>` is FIRST, ahead of identity. The brief frame already
 *   opened with it, so this makes one rule for four modes rather than two rules
 *   for two groups — and in every mode, which of the four interactions this is
 *   frames everything after it.
 *
 *   `<claude4spec_plan_mode>` is LAST despite being tool policy, which by layer
 *   would put it in C. It is a per-turn switch — state, not contract — and it is
 *   a refusal, which is the one kind of instruction that benefits from recency.
 *
 * The adjacencies that are not arbitrary are noted where they stand.
 */
export const DEFAULT_COMPOSITION: readonly CompositionEntry[] = [
  // ── A — the frame ───────────────────────────────────────────────────────
  { layer: 'A', block: 'interaction_context' },
  { layer: 'A', block: 'claude4spec_identity' },

  // ── B — this project ────────────────────────────────────────────────────
  { layer: 'B', block: 'project' },
  { layer: 'B', block: 'entities' },
  /**
   * `<available_skills>` IMMEDIATELY BEFORE `<project_writing_skill>`, and the
   * adjacency is load-bearing rather than tidy: the listing carries the
   * CONVENTION for opening a skill, and the style block issues an INSTRUCTION to
   * open one. Reversed, the model is told to call `load_skill_file` before
   * anything has said what that is or that it is the only channel.
   */
  { layer: 'B', block: 'available_skills' },
  { layer: 'B', block: 'project_writing_skill' },

  // ── C — access ──────────────────────────────────────────────────────────
  { layer: 'C', block: 'tooling' },
  // Right behind `<tooling>`: the operation's contract before the data it consumes.
  { layer: 'C', block: 'workspace_projects' },
  // Promoted out of layer E (it used to sit among the `<current_*>` blocks).
  { layer: 'C', block: 'agent_path_scope' },
  // Directly after the path scope: that block says WHERE, this one WHETHER.
  { layer: 'C', block: 'agent_filesystem_access' },

  // ── D — writing conventions ─────────────────────────────────────────────
  { layer: 'D', block: 'entity_embeds' },
  // Whatever the active entity types contribute, right behind the grammar they extend.
  { layer: 'D', block: 'plugin_prompt_blocks' },
  { layer: 'D', block: 'discovery_and_impact' },
  { layer: 'D', block: 'tags' },
  { layer: 'D', block: 'todo_markers' },
  { layer: 'D', block: 'task_tracking' },
  { layer: 'D', block: 'sections_and_anchors' },
  { layer: 'D', block: 'spec_language' },
  { layer: 'D', block: 'conversational_language' },

  // ── E — current state ───────────────────────────────────────────────────
  { layer: 'E', block: 'current_patch' },
  { layer: 'E', block: 'current_page' },
  // Handling instructions sit BELOW the block they are about. They used to live
  // at the top of `<claude4spec_identity>`, some seven hundred lines above the
  // thing they described.
  { layer: 'E', block: 'current_page_handling' },
  { layer: 'E', block: 'annotations' },
  { layer: 'E', block: 'annotation_handling' },
  { layer: 'E', block: 'current_plan' },
  { layer: 'E', block: 'claude4spec_plan_mode' },
];

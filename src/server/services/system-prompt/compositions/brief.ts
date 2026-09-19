import type { CompositionEntry } from '../types.js';

/**
 * M21 × M44 — the brief context type's OWN composition (`promptComposition:
 * { own: BRIEF_COMPOSITION }`). A separate sequence of ten positions, not the
 * default with cuts: a brief thread edits ONE artifact through brief-tools, holds
 * no plan or entity tools, and mounts release-tools read-only.
 *
 * What it deliberately does not carry, and why:
 *
 *   - the identity, the entity catalogue, the workspace peers and the whole band
 *     of writing conventions (`<discovery_and_impact>` included) — there is no
 *     entity graph and no reference tooling to apply them with;
 *   - `<spec_language>` — it governs specification content, and a brief is a
 *     separate artifact; only `<conversational_language>` rides here;
 *   - `<agent_path_scope>` and `<agent_filesystem_access>` — a brief thread's
 *     posture is not a path scope. 0.2.50 briefly added the path scope here, and
 *     under the shipped `disableDirectFilesystemAccess = true` it read as two
 *     falsehoods at once: `ALLOWED (you may read/write here): …` for directories
 *     the frame grants nothing in, and a prohibition phrased in terms of
 *     built-ins absent from its catalog, with no filesystem-access block to
 *     qualify either. The posture is stated by `<interaction_context
 *     type="brief">` instead; reintroducing either block alone recreates the
 *     inconsistency from one side;
 *   - `<annotation_handling>` and every block about the turn's page, plan or
 *     patch — none of those is pinned to a brief thread.
 *
 * 0.2.19 removed three blocks from this frame: `<claude4spec_brief_identity>` and
 * `<self_contained_invariant>` (both folded into `<interaction_context
 * type="brief">`, whose body M21 owns) and `<writing_style_brief_workflow>` (the
 * host no longer points at a style's internal file layout).
 */
export const BRIEF_COMPOSITION: readonly CompositionEntry[] = [
  // In brief mode the interaction rules ARE the identity.
  { block: 'interaction_context' },
  // Project facts, not genre rules — the same `<project/>` self-close the default
  // composition uses, without `roots`: a brief thread has no page tools to pass
  // a root identifier to.
  { block: 'project', options: { roots: false } },
  // Derived from the mount, like the default composition's — and its `<builtin>`
  // line stays truthful about what this thread actually has.
  { block: 'tooling' },
  { block: 'brief_tools_usage' },
  { block: 'conversational_language' },
  // Before the style block, for the same reason as in the default composition.
  { block: 'available_skills' },
  { block: 'project_writing_skill' },
  { block: 'brief_scope' },
  { block: 'current_brief' },
  // No `<current_page>` here, so no annotation can borrow its root.
  { block: 'annotations', options: { pageRoot: false } },
];

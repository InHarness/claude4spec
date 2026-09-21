import type { Brief } from '../../../../shared/entities.js';
import type { Root } from '../../../../shared/types.js';
import { attrs } from '../glue.js';
import type { PromptBlock } from '../types.js';

/* M21 — Briefs: the brief-tools surface, the brief's root scope and the brief
 * itself. Rendered only where a brief is pinned; which composition carries them
 * is the brief context type's own decision (see `compositions/brief.ts`). */

/**
 * M21: usage contract for the `brief-tools` MCP server.
 * Mounted only when this chat thread has `context_type='brief'`. The editorial
 * doctrine is split in two since 0.2.19: the genre's domain rules arrive in
 * `<interaction_context type="brief">` (M21), the methodology in the active
 * writing style's `workflows/brief.md`. This block is neither — it describes the
 * tool surface, so the agent knows what is callable in this thread.
 */
const BRIEF_TOOLS_USAGE = `<brief_tools_usage>
brief-tools is scoped automatically to this brief — there is no path parameter, and no way to reach another brief from this thread.
  - get_brief — the brief as { frontmatter, body, content, hash }.
  - update_brief — edits the body through EXACTLY ONE of two shapes:
      * \`textEdits\` — literal { find, replaceWith, expectedMatches? } substitutions over the whole body (omitted expectedMatches = exactly 1; overlapping matches refused). Prefer it for punctual changes.
      * \`action\` (replace | append | insert_after_section) + \`content\` — rewrites, appends, section inserts.
      * the answer is { newHash, replacements? } — never your content back.
      * frontmatter is IMMUTABLE for you (type, from_release, to_release, roots, generated_at).
      * expectedHash is REQUIRED: pass the hash get_brief returned (stale → BRIEF_CONFLICT, missing → VALIDATION).
      * insert_after_section MISSES SILENTLY. A target it cannot find — an anchor that is not in the brief, a heading that matches nothing — is NOT an error: the fragment is appended at the END of the brief and the call reports success. Nothing warns you. So read the brief before addressing a section, and check afterwards that the text landed where you meant it to.
  - list_brief_versions / get_brief_version — the brief's version history and one snapshot with content.
</brief_tools_usage>`;

function scopeRootsOf(brief: Brief): string[] {
  const fm = brief.frontmatter;
  return Array.isArray(fm.roots) ? fm.roots.filter((r) => typeof r === 'string') : [];
}

function buildBriefScope(brief: Brief, roots: readonly Root[]): string | null {
  const scopeRoots = scopeRootsOf(brief);
  // 0.1.96 (L13, M21 §121-123): when the brief is scoped to specific page roots,
  // make that scope an explicit, actionable directive — the raw `roots:` frontmatter
  // line inside <current_brief> is too easy for the author to miss, so scoping must
  // not depend on it. Whole-release briefs (no `roots`) emit nothing here.
  if (scopeRoots.length === 0) return null;
  const list = scopeRoots.join(', ');
  const arr = JSON.stringify(scopeRoots);
  // 0.2.101: "does the scope contain the BASE root" is a question about the
  // `builtin` flag, not about the literal `pages` — a project whose base root
  // was renamed to `docs` must still get the whole-release entity directive.
  const baseRootId = roots.find((r) => r.builtin)?.id;
  const includesPages = baseRootId !== undefined && scopeRoots.includes(baseRootId);
  return [
    `<brief_scope ${attrs({ roots: list })}>`,
    `This brief is SCOPED to specific page roots: ${list}. It does NOT cover the whole release.`,
    `- PAGES: pass \`roots: ${arr}\` to EVERY release_diff call (the summary probe AND every heavy slice), and hand the same \`roots\` to each diff-explore subagent slice. Pages outside these roots MUST NOT enter the brief. Omitting \`roots\` defaults release_diff to ALL releasable roots and silently breaks this scope.`,
    `- ENTITIES are root-agnostic (release_diff never filters them by root): include entity changes that are referenced in the scoped pages' prose or are thematically tied to this scope — a relevance judgement, not a structural filter.`,
    includesPages
      ? `- This scope INCLUDES the base page root \`${baseRootId}\` (the carrier of the entity graph), so treat entities as whole-release: include ALL entity changes — omitting one would silently make the brief incomplete.`
      : `- This scope does NOT include the base page root${baseRootId ? ` \`${baseRootId}\`` : ''}, so do not sweep in unrelated entity changes; include only entities relevant to the scoped pages above.`,
    `</brief_scope>`,
  ].join('\n');
}

function buildCurrentBrief(brief: Brief): string {
  const fm = brief.frontmatter;
  const scopeRoots = scopeRootsOf(brief);
  return [
    `<current_brief ${attrs({
      path: brief.path,
      from_release: fm.from_release ?? '(initial)',
      // `attrs()` drops nulls, and an open `to` is now the DEFAULT window —
      // the agent must be able to read that branch off the attribute rather
      // than off its absence. Mirrors `from_release`'s `(initial)`.
      to_release: fm.to_release ?? '(unreleased)',
      implemented: fm.implemented ? 'true' : 'false',
      hash: brief.hash,
      ...(scopeRoots.length > 0 ? { roots: scopeRoots.join(', ') } : {}),
    })}>`,
    brief.content,
    `</current_brief>`,
  ].join('\n');
}

export const M21_PROMPT_BLOCKS: readonly PromptBlock[] = [
  { name: 'brief_tools_usage', render: () => BRIEF_TOOLS_USAGE },
  { name: 'brief_scope', render: (c) => (c.brief ? buildBriefScope(c.brief, c.roots) : null) },
  { name: 'current_brief', render: (c) => (c.brief ? buildCurrentBrief(c.brief) : null) },
];

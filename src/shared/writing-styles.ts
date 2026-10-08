/**
 * 2.1.9 (M15 L4) — wire types of `GET /api/writing-styles`, shared by the server
 * route and the settings/onboarding UI.
 */

/**
 * The set of skill-registry sources (M37 `zscui1qz`, `SkillSource`). The set is
 * the REGISTRY's — this list only mirrors it on the wire, so the UI can badge
 * every value (`src/server/services/skill-registry.ts` re-exports the type, so the
 * two cannot drift apart).
 *
 *  - `user` — a `.claude/skills` root (project or global), scanned on demand;
 *  - `plugin` — contributed by a plugin envelope;
 *  - `project-rooted` — a package of this project's `skills` root (M52);
 *  - `project-exposed` — an attached project exposed as a skill (M52).
 *
 * `bundled` is not a source: the npm package carries no skills root.
 */
export const SKILL_SOURCES = ['user', 'plugin', 'project-rooted', 'project-exposed'] as const;

export type SkillSource = (typeof SKILL_SOURCES)[number];

/**
 * DTO `writing-style-summary` — one element of `available[]` in
 * `WritingStylesResponse`: the frontmatter metadata of a writing style of ANY
 * registry source (`listSelectable()`, scope `writing-style`). No `content`, no
 * `files` — the route serves the choice, never the style.
 */
export interface WritingStyleSummary {
  slug: string;
  title: string;
  /** 1–3 lines (M16 contract: onboarding cards). */
  description: string;
  version: number;
  language: string;
  /** Where the style comes from — any value of {@link SkillSource}. */
  source: SkillSource;
}

/** DTO `writing-styles-response`. */
export interface WritingStylesResponse {
  /** `config.writingStyle`; `null` when no style is chosen. */
  active: string | null;
  available: WritingStyleSummary[];
}

/**
 * The badge a style option carries in the selector (M15 L17 `m6ukdbsc`): one
 * DISTINCT label per source value, not two — a style of this project's skills
 * root must not read as "yours" the way a `.claude/skills` one does, nor an
 * attached project's as "plugin".
 *
 * ASSUMPTION:dev-1202 — the specification asks for a distinct badge per value but
 * names no wording; the two new labels are ours.
 */
export const WRITING_STYLE_SOURCE_BADGE: Readonly<Record<SkillSource, string>> = {
  user: 'yours',
  plugin: 'plugin',
  'project-rooted': 'project skill',
  'project-exposed': 'attached project',
};

/** The selector option's label: the style's title plus its source badge. */
export function writingStyleOptionLabel(style: Pick<WritingStyleSummary, 'title' | 'source'>): string {
  return `${style.title} — ${WRITING_STYLE_SOURCE_BADGE[style.source] ?? style.source}`;
}

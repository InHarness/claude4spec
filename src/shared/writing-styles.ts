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
 * The ONE source → badge label map (M15 L2 `ssh0om79`), shared by both style
 * selection surfaces: the `Writing style` select of the settings page (M15 L17
 * `m6ukdbsc`) and the onboarding style cards (M16 `os387tmx`). The map is
 * complete — every `source` the registry emits has its own label, no two values
 * share one — and the labels are literal UI strings. Both `user` registrations
 * (the project's and the global `.claude/skills` root) share the value `user`,
 * hence the label `yours`. A new registry source needs a new row here: typing
 * the map over {@link SkillSource} makes a missing row a compile error, and no
 * surface invents a label of its own.
 */
export const WRITING_STYLE_SOURCE_BADGE: Readonly<Record<SkillSource, string>> = {
  user: 'yours',
  plugin: 'plugin',
  'project-rooted': 'project skill',
  'project-exposed': 'attached project',
};

/** The badge label of a style's source — read from {@link WRITING_STYLE_SOURCE_BADGE} only. */
export function writingStyleSourceBadge(source: SkillSource): string {
  return WRITING_STYLE_SOURCE_BADGE[source];
}

/** The selector option's label: the style's title plus its source badge. */
export function writingStyleOptionLabel(style: Pick<WritingStyleSummary, 'title' | 'source'>): string {
  return `${style.title} — ${writingStyleSourceBadge(style.source)}`;
}

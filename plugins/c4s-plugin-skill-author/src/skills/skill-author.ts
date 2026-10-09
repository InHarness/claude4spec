import type { PluginSkillContribution } from '@c4s/plugin-runtime';

import skillMd from './skill-author/SKILL.md?raw';

/**
 * Drop the leading YAML frontmatter block.
 *
 * `PluginSkillContribution.content` is the BODY of `SKILL.md`: the metadata is
 * carried by the contribution's own fields and the registry never parses a
 * contributed skill. Deliberately a copy of the sibling envelopes' helper rather
 * than a shared import — this package's only import is `@c4s/plugin-runtime`, and
 * keeping it that way is what makes extracting it a `tsconfig` edit.
 */
function body(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(raw);
  return (match ? raw.slice(match[0].length) : raw).trimStart();
}

/**
 * The skill that teaches the agent to write the project's own skills (M52
 * `3nbgrss4`): procedures, checklists and conventions for the agent, as packages
 * in the project's `skills` root.
 *
 * `contextTypes: ['chat', 'patch']` is an ACTIVE narrowing, not a default —
 * omitting the field would list the skill in all four context types (M13
 * `m13plenv`). It is exactly the two types that mount `spec-skill-tools`, the
 * server of the one tool this skill writes with (`update_skill_file`, M52
 * `hdkx97wq`); in `brief` and `ask` there is nothing it could write with. The
 * narrowing shapes the listing, not access: `load_skill_file('skill-author')`
 * still answers in any turn.
 *
 * The metadata below mirrors the frontmatter of `skill-author/SKILL.md`. Keep the
 * two in step: the file's frontmatter is inert (the registry reads these fields),
 * but it is what an author reads first.
 */
export const skillAuthorSkill: PluginSkillContribution = {
  slug: 'skill-author',
  title: 'Skill Author',
  description:
    "Writes the project's own skills — procedures, checklists and conventions for the agent — as packages in the project's skills root. Open it via load_skill_file('skill-author') when the user asks to create, define or change a project skill (instructions for the agent, not a writing style). Writes only with update_skill_file, so it works with direct file access blocked.",
  version: 1,
  language: 'en',
  scope: 'contextual',
  contextTypes: ['chat', 'patch'],
  content: body(skillMd),
};

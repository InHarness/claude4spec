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
 * 2.1.77 (M52 `3nbgrss4`, pkg `twgy6hnk`, `0n9pjl9k`, `97365qir`): the skill
 * writes LOCAL skills — packages of the `skills` root — in a project of any type,
 * never writes a page of the project, and reads neither the project's type nor its
 * capabilities. Asked for a skill for the other projects of the workspace, it
 * mentions that the author can register a separate Skill project and attach it on
 * the `#skills` tab by hand; it does neither itself.
 *
 * The metadata below mirrors the frontmatter of `skill-author/SKILL.md`. Keep the
 * two in step: the file's frontmatter is inert (the registry reads these fields),
 * but it is what an author reads first.
 */
export const skillAuthorSkill: PluginSkillContribution = {
  slug: 'skill-author',
  title: 'Skill Author',
  description:
    "Writes the project's local skills — procedures, checklists and conventions for the agent — as packages in the project's skills root, in a project of any type. Open it via load_skill_file('skill-author') when the user asks to create, define or change a project skill (instructions for the agent, not a writing style). Writes only with update_skill_file, so it works with direct file access blocked, and never writes project pages. A skill for the other projects of the workspace is a separate project of type Skill, which the author creates and attaches in the #skills settings tab by hand.",
  version: 1,
  language: 'en',
  scope: 'contextual',
  contextTypes: ['chat', 'patch'],
  content: body(skillMd),
};

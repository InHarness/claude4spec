import type { PluginSkillContribution } from '@c4s/plugin-runtime';

import skillMd from './writing-style-author/SKILL.md?raw';

/**
 * Drop the leading YAML frontmatter block.
 *
 * `PluginSkillContribution.content` is the BODY of `SKILL.md`, not the file: the
 * metadata beside it (`title`, `description`, `version`, `language`, `scope`) is
 * carried by the contribution's own fields, and the registry never parses a
 * contributed skill. The FS roots get this from gray-matter; a contribution has no
 * file to hand it, so the four lines below are the whole of it.
 *
 * Deliberately not a dependency, and deliberately a copy of the sibling envelope's
 * helper rather than a shared import: this package's only import is
 * `@c4s/plugin-runtime`, and keeping it that way is what makes extracting it to its
 * own repo a `tsconfig` edit rather than a port.
 */
function body(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(raw);
  return (match ? raw.slice(match[0].length) : raw).trimStart();
}

/**
 * The writing-style authoring skill, moved out of the host's in-package skills root.
 *
 * It was that root's LAST inhabitant, so this move is what let the root be deleted
 * outright — the reference style had already left for
 * `c4s-plugin-layered-vertical-slices` in 0.2.57. With it gone the host ships no
 * skill of its own at all.
 *
 * `contextTypes: ['chat']` is an ACTIVE narrowing, not a default: omitting the field
 * would put this skill on the listing of all four context types. Chat is where a
 * user asks for a new style; a `brief` or `patch` turn is mid-genre and has no
 * business being offered a scaffold. Note what the narrowing does NOT do — a model
 * that knows the slug can still `load_skill_file('writing-style-author')` in any
 * turn, because the filter shapes the listing and not the reader.
 *
 * The metadata below is a verbatim copy of the frontmatter this package carried in
 * `src/server/skills/writing-style-author/SKILL.md`. Keep the two in step: the file's
 * own frontmatter is now inert (the registry reads these fields, not the file), but
 * it is what an author reads first.
 *
 * No `files`: this skill has always been a single `SKILL.md`. The instruction it
 * carries tells the AGENT to write a `workflows/` directory into the style it
 * scaffolds — that is the skill's OUTPUT, not part of its own package, and giving
 * this contribution a `workflows/` of its own would be a different document
 * altogether.
 */
export const writingStyleAuthorSkill: PluginSkillContribution = {
  slug: 'writing-style-author',
  title: 'Writing Style Author',
  description:
    "Scaffolds a new writing-style skill from a chat request — e.g. 'create a writing style for our team that writes terse, code-first briefs'. Open it via load_skill_file('writing-style-author') when the user asks to create/define/author a new writing style. Produces a project-local .claude/skills/<slug>/ package — SKILL.md plus a workflows/ directory — selectable from the very next query.",
  version: 1,
  language: 'en',
  scope: 'contextual',
  contextTypes: ['chat'],
  content: body(skillMd),
};

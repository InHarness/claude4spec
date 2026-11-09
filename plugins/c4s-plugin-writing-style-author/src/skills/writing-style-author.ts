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
 * 2.1.9 (M15 `m15wsauth`): the scaffold writes through `update_skill_file` into the
 * project's skills root (`.claude4spec/skills/<slug>/`), so it works with direct file
 * access blocked; it does not write in `brief`/`ask` (no `spec-skill-tools` there),
 * and a request for a non-style package is sent to `skill-author`.
 *
 * 2.1.77 (M15 `m15wsauth`, `e5635uwn`, `lyygimdd`, `m15edg001`; pkg `vt1nmnwx`,
 * `l71kgcft`): one route only. The style is always a LOCAL style — the package
 * above, written with `update_skill_file` — in a project of any type; the skill
 * reads neither the project's type nor its capabilities, and never writes a page
 * of the project with any page tool (also not in a Writing Style project, whose
 * pages are its exposed style). A style for the other projects of the workspace is
 * a separate Writing Style project the author registers and attaches on the
 * `#skills` tab by hand; the skill only mentions it. The exposed-style route of
 * 2.1.15 (route choice, base-root pages, the `#skills` pointer to expose the
 * project) is gone.
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
    "Authors a new writing style from a chat request — e.g. 'create a writing style for our team that writes terse, code-first briefs'. Open it via load_skill_file('writing-style-author') when the user asks to create/define/author a new writing style. The style is always a local style: a package in the project's skills root (.claude4spec/skills/<slug>/ — SKILL.md plus a workflows/ directory) written with update_skill_file, selectable from the very next query; it never writes project pages. A style for the other projects of the workspace is a separate project of type Writing Style, which the author creates and attaches in the #skills settings tab by hand. Writing styles only: any other kind of skill package belongs to the skill-author skill.",
  version: 1,
  language: 'en',
  scope: 'contextual',
  contextTypes: ['chat'],
  content: body(skillMd),
};

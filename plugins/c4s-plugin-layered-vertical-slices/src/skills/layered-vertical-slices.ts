import type { WritingStyleContribution } from '@c4s/plugin-runtime';

import skillMd from './layered-vertical-slices/SKILL.md?raw';
import workflowBootstrap from './layered-vertical-slices/workflows/bootstrap.md?raw';
import workflowBrief from './layered-vertical-slices/workflows/brief.md?raw';
import workflowDaily from './layered-vertical-slices/workflows/daily.md?raw';
import workflowPatch from './layered-vertical-slices/workflows/patch.md?raw';
import templateIndex from './layered-vertical-slices/templates/index.md?raw';
import templateLayer from './layered-vertical-slices/templates/layer.md?raw';
import templateModule from './layered-vertical-slices/templates/module.md?raw';

/**
 * Drop the leading YAML frontmatter block.
 *
 * `PluginSkillContribution.content` is the BODY of `SKILL.md`, not the file:
 * the metadata beside it (`title`, `description`, `version`, `language`) is
 * carried by the contribution's own fields, and the registry never parses a
 * contributed skill. The disk roots get this from gray-matter; a contribution
 * has no file to hand it, so the four lines below are the whole of it.
 *
 * Deliberately not a dependency: the envelope's only import is
 * `@c4s/plugin-runtime`, and keeping it that way is what makes extracting this
 * package to its own repo a `tsconfig` edit rather than a port.
 */
function body(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(raw);
  return (match ? raw.slice(match[0].length) : raw).trimStart();
}

/**
 * The reference writing style, moved out of the host's bundled skills root.
 *
 * It travels as literals rather than as files, and that is the ONE real cost
 * difference against the `bundled` and `user` roots: those resolve a package
 * lazily off the disk on every read, this one sits in the registry's memory
 * from registration onwards. In exchange it is distributable — the whole point
 * of the move.
 *
 * `scope` is absent because `contributes.writingStyles[]` is sugar for
 * `contributes.skills[]` with `scope: 'writing-style'`; the host lowers it.
 *
 * The metadata below is a verbatim copy of the frontmatter this package carried
 * in `src/server/skills/layered-vertical-slices/SKILL.md`. Keep the two in step:
 * the file's own frontmatter is now inert (the registry reads these fields, not
 * the file), but it is what an author reads first.
 */
export const layeredVerticalSlicesStyle: WritingStyleContribution = {
  slug: 'layered-vertical-slices',
  title: 'Layered Vertical Slices',
  description:
    'Conventions for layered, vertical-slice specifications — module/layer structure, file layout, two workflows (bootstrap and daily), and quality rules. TRIGGER when the active writing style is this slug — editing a spec page, drafting plans, creating modules or layers, answering structural questions.',
  version: 1,
  language: 'en',
  content: body(skillMd),
  /**
   * Keys are POSIX paths relative to the skill package — the same addresses
   * `load_skill_file(slug, file)` takes, and the same ones the directory used
   * on disk. A renamed key is a broken cross-reference in the prose, so the
   * shape of this map is part of the contribution, not an implementation
   * detail of it.
   */
  files: {
    'workflows/bootstrap.md': workflowBootstrap,
    'workflows/brief.md': workflowBrief,
    'workflows/daily.md': workflowDaily,
    'workflows/patch.md': workflowPatch,
    'templates/index.md': templateIndex,
    'templates/layer.md': templateLayer,
    'templates/module.md': templateModule,
  },
};

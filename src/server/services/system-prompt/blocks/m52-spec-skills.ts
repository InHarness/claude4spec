import { attrs, hasServer, selfClose } from '../glue.js';
import type { CurrentSkillRef, PromptBlock } from '../types.js';
import type { AvailableSkillsLineContribution } from './m37-skills.js';

/* M52 — Spec Skills: its prompt contribution (L16, 2.1.9). */

/** The server `update_skill_file` lives on (`SPEC_SKILL_TOOLS_SERVER` in `mcp/spec-skill-tools.ts`). */
const SPEC_SKILL_TOOLS = 'spec-skill-tools';

/**
 * `<available_skills>` — M52's lines (template `szablon-available-skills-spec-skills`,
 * `6evgp041`). The frame is the skill registry's (M37); this contribution is only
 * lines of its body, each with its own emission condition:
 *
 *  - `skill_ref` — always;
 *  - the exposed project — when the turn's listing carries an entry of origin
 *    `project-exposed`;
 *  - `update_skill_file` — when `spec-skill-tools` is mounted in the turn;
 *  - the hit translation — when the `skills` root holds at least one file.
 */
export const M52_AVAILABLE_SKILLS_LINES: AvailableSkillsLineContribution = {
  module: 'M52',
  render: (c) => {
    const lines = [`A <skill_ref slug="x"/> in the user's message means: call load_skill_file("x") first, before anything else.`];
    if (c.availableSkills.some((s) => s.origin === 'project-exposed')) {
      lines.push(
        `An entry with origin="project-exposed" is read-only here: to change it, propose the change to that project with ask, using its project attribute as the address.`,
      );
    }
    if (hasServer(c.mcpInventory, SPEC_SKILL_TOOLS)) {
      lines.push(`Write the files of this project's own skills with update_skill_file.`);
    }
    if (c.skillsRootHasFiles === true) {
      lines.push(
        `A find_references or check_consistency hit in the root "skills" at <slug>/<rest of path> is read with load_skill_file("<slug>", "<rest of path>").`,
      );
    }
    return lines;
  },
};

/**
 * `<current_skill>` (template `szablon-current-skill`, `9zio901p`): the open file
 * of a `skills`-kind root — identity only, never content, then one line saying how
 * (and whether) it can be read. Two variants:
 *
 *  - the package `load_skill_file` returns for this slug (valid, or invalid with
 *    no other source resolving the slug — the response then marks it invalid);
 *  - SHADOWED: another source resolves the slug, so `load_skill_file` returns that
 *    winner, not this file — and the agent has no route to the file at all
 *    (`rkbsi6ky` edge case 13).
 *
 * No open file of this kind → no block. An open page does not stand in for it:
 * `<current_page>` covers roots of kind `pages` only (M02 `cg80qj0e`).
 */
export function buildCurrentSkill(skill: CurrentSkillRef): string {
  const tag = selfClose('current_skill', attrs({ slug: skill.slug, file: skill.file }));
  if (skill.shadowedBy) {
    return [
      tag,
      `The user has this skill file open, but it is shadowed: the slug resolves to the skill "${skill.shadowedBy.slug}" from source "${skill.shadowedBy.source}", and load_skill_file returns that skill, not this file. You have no way to read this file — not with load_skill_file, not with page tools, not with built-in file tools. It becomes readable through load_skill_file only once its package is renamed to a slug no other source resolves.`,
    ].join('\n');
  }
  return [
    tag,
    `The user has this skill file open. Read it with load_skill_file(slug, file) — also when the package is not valid yet and no other source resolves this slug: the response then marks it invalid and says why. Page tools do not reach this root.`,
  ].join('\n');
}

export const M52_PROMPT_BLOCKS: readonly PromptBlock[] = [
  {
    name: 'current_skill',
    render: (c) => (c.currentSkill ? buildCurrentSkill(c.currentSkill) : null),
  },
];

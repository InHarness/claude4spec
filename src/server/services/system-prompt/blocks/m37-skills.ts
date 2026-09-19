import { attrs, selfClose } from '../glue.js';
import type { PromptBlock } from '../types.js';

/* M37 — Internal Skills Registry: the skill listing and its only channel. */

/**
 * `<available_skills>` — the listing, plus the channel rule that governs all of it.
 *
 * ## Always emitted, empty or not
 *
 * A project with no skills still gets the block, carrying only the instruction. An
 * ABSENT block is indistinguishable from a host that has no concept of skills,
 * which is a different and wronger thing to tell the model than "this project has
 * none": the first invites it to look for skills some other way, the second closes
 * the question.
 *
 * ## Why the instruction is here and not in the tool description
 *
 * The two prohibitions — never `Skill()`, never `Read` — are about tools this
 * block does not own, so they cannot live in `load_skill_file`'s own description.
 * The native `Skill` tool stays in the toolset and the SDK discovers skills of its
 * own through `settingSources` (`~/.claude/skills`), so without this line the
 * model has two channels to one concept, one of which reaches a different set of
 * documents.
 *
 * ## This soft block is PERMANENT (0.2.50)
 *
 * It used to be described as layer 1 of three, with layer 2 waiting on a
 * `disallowedTools: ['Skill']` field that `@inharness-ai/agent-adapters` would
 * eventually expose. That wait is over and the answer was no: 0.9.6 REJECTED
 * per-name `disallowedTools` permanently in favour of semantic
 * `disallowedToolGroups`. The condition "when the dependency exposes the field"
 * will never be met, so do not build a watch or a TODO on it.
 *
 * Outside plan mode there is therefore no hard block on native `Skill()`, and
 * there will not be one — this prompt line is the whole mechanism. Inside plan
 * mode `Skill` IS silenced, but only incidentally: it belongs to the `shell`
 * group, which `planMode` denies, so it disappears from the model's tool
 * catalog entirely. That is a reversal of the old behaviour, where `Skill` sat
 * in the read-only class and plan mode preserved it.
 *
 * The remaining layer is the `SubagentDefinition.tools` allow-lists, which name
 * no `Skill` and must not start to.
 *
 * The builder knows nothing about where the listing came from or how a package is
 * laid out — it renders slugs, descriptions and a fixed rule.
 */
function buildAvailableSkills(entries: { slug: string; description: string }[]): string {
  const lines = [`<available_skills>`];
  for (const e of entries) {
    lines.push(`  ${selfClose('skill', attrs({ slug: e.slug, description: e.description }))}`);
  }
  lines.push(
    `  Open a skill with load_skill_file(slug) — it returns the skill body plus a manifest of its package files.`,
    `  Read a subfile the skill points you to with load_skill_file(slug, file), e.g. load_skill_file("${entries[0]?.slug ?? 'some-skill'}", "workflows/brief.md").`,
    `  Never open a skill with the native Skill() tool and never read one with Read — skills are not files you can reach; load_skill_file is the only channel.`,
    `</available_skills>`,
  );
  return lines.join('\n');
}

export const M37_PROMPT_BLOCKS: readonly PromptBlock[] = [
  { name: 'available_skills', render: (c) => buildAvailableSkills(c.availableSkills) },
];

import { attrs } from '../glue.js';
import type { PromptBlock } from '../types.js';

/* M15 — Writing Styles: the active style, as a binding instruction to read it. */

/**
 * The writing-style slot. 0.2.50 renames the block from `<project_skill>` to
 * `<project_writing_skill>` and stops describing what is inside it.
 *
 * The name first: M37 gives this slot to the active WRITING STYLE and to nothing
 * else — at most one, never a general project skill — while every other skill
 * of the turn rides the `<available_skills>` listing. `<project_skill>` named
 * the opposite of what the slot is.
 *
 * The contents second, which is the more consequential half. The block used to
 * assert that the skill "contains the BINDING project specification — module/
 * layer structure, file layout, naming, workflow, and quality rules". Nothing
 * guarantees any of that: the slot is filled from `config.writingStyle` and
 * validated only for presence in the registry and `meta.scope ===
 * 'writing-style'`. That sentence describes ONE project's skill, shipped to
 * every installation as a fact — and it is the kind of falsehood that suppresses
 * its own discovery, because an agent told what a document contains has a reason
 * not to open it.
 *
 * 0.2.50 finishes the thought. The block briefly rendered the skill's own
 * `description` instead — truer than the invented sentence, but the same shape
 * of mistake: a `description` is a blurb written to help a model DECIDE whether
 * to open a skill, and here there is no decision left, since the style is
 * already selected and the block orders it read regardless. It is `summarise
 * what the document contains` by another route, and buys nothing for the tokens.
 *
 * What the block says now is generic and true of every writing style: one
 * exists, it binds everything you produce, and you have not read it yet.
 *
 * Also gone: "re-call whenever you transition from plan mode into execution".
 * The system prompt is frozen after the first turn (`setInitialSystemPrompt`),
 * so that transition has no representation the agent can observe — the
 * instruction names an event it will never see happen.
 */
function buildProjectWritingSkill(ws: { slug: string; title: string }): string {
  return [
    `<project_writing_skill ${attrs({ slug: ws.slug, title: ws.title })}>`,
    `This project has an active writing style, and it is BINDING on everything you produce: pages, plans, entity content, and the structure of your answers all follow it.`,
    ``,
    `You do not know its conventions yet, and this block does not summarise them.`,
    `  1. Before your first tool call in this thread, call load_skill_file("${ws.slug}") and read it.`,
    `  2. Treat its content as authoritative. If a request seems to contradict it, surface the conflict rather than quietly overriding the convention.`,
    `</project_writing_skill>`,
  ].join('\n');
}

export const M15_PROMPT_BLOCKS: readonly PromptBlock[] = [
  {
    name: 'project_writing_skill',
    render: (c) => (c.writingStyleSkill ? buildProjectWritingSkill(c.writingStyleSkill) : null),
  },
];

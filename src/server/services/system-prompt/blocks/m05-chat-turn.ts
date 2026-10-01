import type { Annotation } from '../../../../shared/entities.js';
import { attrs } from '../glue.js';
import type { PromptBlock, PromptContext } from '../types.js';

/*
 * M05 — Chat & Agent: what the chat turn itself brings to the prompt.
 *
 * 2.1.1 — `<annotations>`, `<annotation_handling>` and `<task_tracking>` moved
 * here from M48's own blocks. Each is a fact about the chat turn (the
 * annotations the user attached, the live task list the user watches), not
 * about the prompt itself, so they are the chat module's contribution — and
 * the pairing "`<annotation_handling>` iff `<annotations>`" now sits in one
 * file, on one predicate. The rendered text is unchanged.
 *
 * Emission:
 *  - `annotations` / `annotation_handling` — only when the turn carries at
 *    least one annotation;
 *  - `task_tracking` — every frame but `ask`.
 */

/**
 * 0.2.50 — each annotation now carries the `root` of the page it sits on, where
 * that is knowable.
 *
 * `page` alone is not an address: `get_page` without a `rootId` answers
 * INVALID_ARGUMENT. `<current_page>` has always carried its root, so an
 * annotation — which asks the agent to go and read a page — was the one block
 * naming a page it could not open. The asymmetry had no reason behind it.
 *
 * Knowable means: an annotation is raised from the page the user is viewing, so
 * an annotation whose `page` matches the current page shares its root. An
 * annotation carried over from a different page does not say which root it came
 * from — the client's annotation record has no such field — and rather than
 * guess, those render without the attribute and `<annotation_handling>` says
 * what to do about it. Threading a root through the client's annotation wire
 * type is the real fix and is a change of its own.
 */
function buildAnnotations(
  annotations: Annotation[],
  currentPagePath: string | null,
  currentPageRootId: string,
): string {
  const lines: string[] = [`<annotations>`];
  for (const a of annotations) {
    const root = currentPagePath && a.page === currentPagePath ? currentPageRootId : undefined;
    lines.push(
      `  <annotation ${attrs({ page: a.page, root, comment: a.comment ?? '' })}>`,
      a.text,
      `  </annotation>`,
    );
  }
  lines.push(`</annotations>`);
  return lines.join('\n');
}

/**
 * 0.2.65 — the block that makes task tracking OURS rather than the preset's.
 *
 * A project with `agent.claudeUsePreset: false` REPLACES the Claude Code preset
 * rather than appending to it, and the preset carried the only "keep a task
 * list" instruction the model ever saw. This project has run with the preset off
 * since 2026-07-04, so for two months the agent was asked to track nothing —
 * which is why it did so less and less consistently. Stated here, the behaviour
 * stops being a function of that flag.
 *
 * WHY IT LEADS WITH `TodoWrite`, and not with the `TaskCreate`/`TaskUpdate` pair
 * the reporting brief prescribed: against the version this repo actually pins
 * (`agent-adapters` ^0.9.9, published), those two are precisely the calls that do
 * not persist. `mergeTaskToolInputIntoSnapshot` there merges only when the raw
 * input carries a top-level `subject`/`description`/`activeForm`/`status`, so a
 * batch `TaskCreate({ tasks: [...] })` returns nothing and a `TaskUpdate` keyed on
 * `state` is a silent no-op. `TodoWrite` takes a different route entirely —
 * `todoItemsFromTodoWriteInput`, a full-list replace with no such guard — and
 * reaches `chat_thread.current_todo_items` TODAY. Naming only the pair would have
 * steered the model off the one path that still works, and made the panel less
 * likely to fill rather than more. The pair is named as an equal because it is
 * the right shape once the library fix (unreleased at time of writing, commit
 * `287d2cc`) ships; nothing here has to change then.
 *
 * The tools themselves are opted into explicitly in `agent-turn.ts` — see
 * `autoApproveTools` there. Instruction and capability are separate things.
 *
 * Omitted from the `ask` frame. That turn is a headless read-only peer consult
 * with no viewer, so its list would be written for nobody — and the block's whole
 * premise, that someone is watching it advance, would be a false statement.
 */
const TASK_TRACKING = `<task_tracking>
Work that takes more than a couple of steps gets a TASK LIST, and the user watches it advance while you work — the list is rendered live beside your reply, so it is a channel to them, not a private scratchpad.

Keep it with \`TodoWrite\`, which takes the WHOLE list every time: send it as soon as the shape of the work is clear, BEFORE the first substantive step rather than after it, and resend it with updated statuses as you go. A list published at the end documents what you did, which your reply already does. (\`TaskCreate\` / \`TaskUpdate\` express the same thing one task at a time and are equally welcome.)

Name each task as the outcome it produces, not as the tool you will reach for. Mark a task in progress when you start it and completed the moment it is done, with exactly one in progress at a time — a list that jumps from all-pending to all-completed in one burst told the user nothing while they were waiting.

Skip the list for single-step work and for a question you can simply answer. A one-item list is noise.
</task_tracking>`;

/**
 * 0.2.50 — the block gained the trap, which is the whole reason it is worth its
 * space.
 *
 * An annotation's `text` is the user's SELECTION as Tiptap rendered it, not as
 * the markdown was authored. It looks like a ready-made `textEdits.find`, and
 * for an unformatted sentence it happens to work. Over anything carrying
 * emphasis, a link or an embed, the rendered text and the source text are
 * different bytes, `find` is literal, and the call answers FIND_NOT_FOUND — a
 * failure whose cause is invisible from where the agent stands.
 */
const ANNOTATION_HANDLING = `<annotation_handling>
When the request carries \`<annotations>\`, they are the primary context for the user's message — address each one specifically. Before answering about a page other than the current one, open it: \`get_page\` needs a \`rootId\` as well as a path. An annotation on the current page carries its \`root\`; one without that attribute came from elsewhere and does not know its root — find it with \`list_pages\` rather than assuming \`pages\`.

Do NOT paste an annotation's \`text\` into \`textEdits.find\`. That text is the user's selection as RENDERED, while \`find\` matches the source literally, byte for byte — so any emphasis, link or embed inside the selection makes the two differ and the edit fails FIND_NOT_FOUND. Read the source around the annotation and build the find-string from what is actually written there.
</annotation_handling>`;

const hasAnnotations = (c: PromptContext): boolean => c.annotations.length > 0;

export const M05_TURN_BLOCKS: readonly PromptBlock[] = [
  {
    name: 'annotations',
    /**
     * Option `pageRoot: false` — for a composition with no `<current_page>`, so
     * that no annotation borrows a root from a page the prompt does not show.
     */
    render: (c, options) =>
      hasAnnotations(c)
        ? options?.pageRoot === false
          ? buildAnnotations(c.annotations, null, 'pages')
          : buildAnnotations(c.annotations, c.currentPagePath, c.currentPageRootId)
        : null,
  },
  { name: 'annotation_handling', render: (c) => (hasAnnotations(c) ? ANNOTATION_HANDLING : null) },
  { name: 'task_tracking', render: (c) => (c.contextType === 'ask' ? null : TASK_TRACKING) },
];

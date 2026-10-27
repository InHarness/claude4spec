import type { Annotation } from '../../../../shared/entities.js';
import { attrs } from '../glue.js';
import type { PromptBlock, PromptContext } from '../types.js';

/*
 * M05 — Agent Runtime: what the agent turn itself brings to the prompt.
 *
 * 2.1.1 — `<annotations>` and `<annotation_handling>` moved here from M48's own
 * blocks. Each is a fact about the turn (the annotations the user attached), not
 * about the prompt itself, so they are the turn module's contribution — and the
 * pairing "`<annotation_handling>` iff `<annotations>`" sits in one file, on one
 * predicate.
 *
 * 2.1.56 — `<task_tracking>` is gone, with its template: the module no longer
 * contributes it, and no composition carries it.
 *
 * Emission: `annotations` / `annotation_handling` — only when the turn carries
 * at least one annotation.
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
  currentPageRootId: string | null,
): string {
  const lines: string[] = [`<annotations>`];
  for (const a of annotations) {
    const root = currentPagePath && a.page === currentPagePath ? (currentPageRootId ?? undefined) : undefined;
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
          ? buildAnnotations(c.annotations, null, null)
          : buildAnnotations(c.annotations, c.currentPagePath, c.currentPageRootId)
        : null,
  },
  { name: 'annotation_handling', render: (c) => (hasAnnotations(c) ? ANNOTATION_HANDLING : null) },
];

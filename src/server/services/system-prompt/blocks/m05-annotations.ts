import type { Annotation } from '../../../../shared/entities.js';
import { attrs } from '../glue.js';
import type { PromptBlock } from '../types.js';

/*
 * M05 — Chat & Agent: the user's annotations on the turn.
 *
 * 2.1.1 — `<annotations>` moved here from M48's own blocks. What it carries is
 * the chat's turn payload (the annotations the user attached to the message),
 * not something about the prompt itself, so it is the chat module's
 * contribution. The rendered text is unchanged.
 *
 * Emission: only when the turn carries at least one annotation.
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

export const M05_ANNOTATION_BLOCKS: readonly PromptBlock[] = [
  {
    name: 'annotations',
    /**
     * Option `pageRoot: false` — for a composition with no `<current_page>`, so
     * that no annotation borrows a root from a page the prompt does not show.
     */
    render: (c, options) =>
      c.annotations.length > 0
        ? options?.pageRoot === false
          ? buildAnnotations(c.annotations, null, 'pages')
          : buildAnnotations(c.annotations, c.currentPagePath, c.currentPageRootId)
        : null,
  },
];

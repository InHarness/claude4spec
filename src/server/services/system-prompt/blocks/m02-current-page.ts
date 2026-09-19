import { attrs, selfClose } from '../glue.js';
import type { PromptBlock } from '../types.js';

/* M02 — Pages: the page the user has open, and how to read the rest of it. */

/**
 * 0.2.56 — the block stops sending a long page down the whole-page path.
 *
 * It used to answer "the rest is missing" with `get_page`, which reads the entire
 * file to hand back a preview's worth of what was wanted — and on a page over the
 * response budget comes back truncated anyway. `get_page_outline` answers the same
 * question for a fraction of it, hands back the anchors to fetch, and carries the
 * page `hash` on its envelope, so the sectional route now closes on a write rather
 * than stopping one call short of one.
 *
 * What it must never name is a filesystem read. `agent.disableDirectFilesystemAccess`
 * defaults to TRUE, which removes `Read` from the catalogue outright — a prompt
 * pointing there is pointing at a tool the agent does not have.
 */
const CURRENT_PAGE_HANDLING = `<current_page_handling>
\`<current_page>\` is what the user is looking at right now. It carries the page's \`path\` and its \`root\` — and you need both, because \`get_page\` without a \`rootId\` answers INVALID_ARGUMENT. Long pages are inlined only as a preview (see the \`preview_lines\` / \`total_lines\` attributes). To see the rest, prefer the sectional route where it is open to you: \`get_page_outline({ rootId, path })\` returns every section as a tree with its size and its anchor, and its envelope carries the page's \`hash\`; then \`get_sections({ anchors })\` reads only the ones you actually need. That route needs a SECTION-INDEXED root — on any other root \`get_page_outline\` answers INVALID_ARGUMENT and \`get_page\` is the only way through. The truncation notice inside \`<current_page>\` already names whichever route applies to the page you are looking at; follow it rather than guessing. Use \`get_page\` when you genuinely need the whole page. Either way you end up holding the \`hash\` that \`update_page\` and \`update_sections\` require as \`expectedHash\`, so editing a page never depends on reading all of it.
</current_page_handling>`;

const CURRENT_PAGE_PREVIEW_LINES = 40;

function buildCurrentPage(
  path: string,
  body: string | null,
  root: string,
  sectionIndexed: boolean,
): string {
  if (body === null) {
    return selfClose('current_page', attrs({ path, root, unavailable: 'true' }));
  }
  if (body.trim() === '') {
    return selfClose('current_page', attrs({ path, root, empty: 'true' }));
  }
  const lines = body.split('\n');
  const totalLines = lines.length;
  if (totalLines <= CURRENT_PAGE_PREVIEW_LINES) {
    return `<current_page ${attrs({ path, root, total_lines: totalLines })}>\n${body}\n</current_page>`;
  }
  const preview = lines.slice(0, CURRENT_PAGE_PREVIEW_LINES).join('\n');
  const remaining = totalLines - CURRENT_PAGE_PREVIEW_LINES;
  /**
   * The marker names CORE OPERATIONS, and never a filesystem read.
   *
   * 0.2.50 removed the "Read {path}" it used to carry: with
   * `agent.disableDirectFilesystemAccess` — default TRUE — `Read` is not in the
   * agent's catalogue at all, so the notice was pointing at a tool that does not
   * exist. That constraint is standing, not a one-off fix: whatever this line says
   * next, it may not send the agent to the disk.
   *
   * 0.2.56 leads with the sectional route instead of `get_page`. Reading a whole page
   * to reach part of it is the expensive answer, it truncates again past the response
   * budget, and `get_page_outline` supplies both halves of what comes next — the anchors
   * to fetch, and the page `hash` that arms the write.
   *
   * That route is offered only when the page's root is SECTION-INDEXED. `get_page_outline`
   * goes through `RootSet.requireSectionIndexed`, which answers INVALID_ARGUMENT on a
   * root without an index — so on such a root the sectional lead would be an instruction
   * that cannot succeed, and the notice names `get_page` instead. This is the same rule
   * `get_page`'s own `truncationHint` follows (`ops/pages.ts`, `lineWindowsRefused`): a
   * hint never proposes a call the operation it points at refuses.
   */
  return `<current_page ${attrs({
    path,
    root,
    total_lines: totalLines,
    preview_lines: `1-${CURRENT_PAGE_PREVIEW_LINES}`,
  })}>
${preview}
[... ${remaining} more line${remaining === 1 ? '' : 's'} truncated. ${
    sectionIndexed
      ? `To read on, call get_page_outline({ rootId: "${root}", path: "${path}" }) and then get_sections({ anchors }) for the sections you need — that get_page_outline envelope also carries the page hash that update_page and update_sections take as expectedHash. Call get_page({ rootId: "${root}", path: "${path}" }) only when you need the whole page.`
      : `To read on, call get_page({ rootId: "${root}", path: "${path}" }) — this root is not section-indexed, so get_page_outline and get_sections do not apply to it. The response carries the page hash that update_page takes as expectedHash.`
  }]
</current_page>`;
}

const hasCurrentPage = (c: { contextType: string; currentPagePath: string | null }): boolean =>
  // 0.1.79: `ask` (peer-consult) emits no `<current_*>` page block — it explores
  // the peer's spec headlessly, with no "current page" anchor.
  c.contextType !== 'ask' && c.currentPagePath !== null && c.currentPagePath !== '';

export const M02_PROMPT_BLOCKS: readonly PromptBlock[] = [
  {
    name: 'current_page',
    render: (c) =>
      hasCurrentPage(c)
        ? buildCurrentPage(
            c.currentPagePath!,
            c.currentPageBody,
            c.currentPageRootId,
            /**
             * An unknown root defaults to section-indexed: `pages`, the builtin every
             * project has, is indexed, and the notice for a root this context cannot
             * see should read like the normal case rather than like the exception.
             */
            c.roots.find((r) => r.id === c.currentPageRootId)?.sectionIndexed ?? true,
          )
        : null,
  },
  // The same gate as `<current_page>`: with no page open, the handling instruction
  // would have no subject.
  { name: 'current_page_handling', render: (c) => (hasCurrentPage(c) ? CURRENT_PAGE_HANDLING : null) },
];

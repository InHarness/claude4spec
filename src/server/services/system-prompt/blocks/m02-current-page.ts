import { attrs, selfClose } from '../glue.js';
import type { PromptBlock } from '../types.js';

/* M02 — Pages: the page the user has open, and how to read it. */

/**
 * 0.2.105 — `<current_page_handling>` is the ONLY place in the prompt that names the
 * route to the page's content: `<current_page>` itself carries identity and size and
 * not one line of the page, so there is no truncation notice left to defer to.
 *
 * 0.2.56 — the sectional route leads. `get_page_outline` answers "which part do I
 * need" for a fraction of a whole-page read, hands back the anchors to fetch, and
 * carries the page `hash` on its envelope, so the route closes on a write.
 *
 * What it must never name is a filesystem read. `agent.disableDirectFilesystemAccess`
 * defaults to TRUE, which removes `Read` from the catalogue outright — a prompt
 * pointing there is pointing at a tool the agent does not have.
 */
const CURRENT_PAGE_HANDLING = `<current_page_handling>
\`<current_page>\` is what the user is looking at right now. It carries the page's \`path\`, its \`root\` and its \`total_lines\` — and you need the first two together, because \`get_page\` without a \`rootId\` answers INVALID_ARGUMENT. The page's CONTENT is NOT in this prompt: not one line of it, however short the page is. Read it, and prefer the sectional route where it is open to you: \`get_page_outline({ rootId, path })\` returns every section as a tree with its size and its anchor, and its envelope carries the page's \`hash\`; then \`get_sections({ anchors })\` reads only the ones you actually need. That route needs a SECTION-INDEXED root — on any other root \`get_page_outline\` answers INVALID_ARGUMENT and \`get_page\` is the only way through. Use \`get_page\` when you genuinely need the whole page; \`total_lines\` is there to tell you whether that is cheap. Either way you end up holding the \`hash\` that \`update_page\` and \`update_sections\` require as \`expectedHash\`, so editing a page never depends on reading all of it.
</current_page_handling>`;

/**
 * 0.2.105 — identity and size, never content, in every variant a self-closing tag.
 *
 * The block used to inline pages up to forty lines and preview longer ones behind a
 * truncation marker; both are gone, and with them the `empty="true"` case — a page
 * with no body differs from any other only by its `total_lines`. The body is still
 * read, but only to count it. `unavailable` REPLACES `total_lines`: a failed read has
 * no size to report.
 */
function buildCurrentPage(path: string, body: string | null, root: string): string {
  if (body === null) {
    return selfClose('current_page', attrs({ path, root, unavailable: 'true' }));
  }
  // A zero-length body is zero lines, not the one line `''.split('\n')` would count.
  const totalLines = body === '' ? 0 : body.split('\n').length;
  return selfClose('current_page', attrs({ path, root, total_lines: totalLines }));
}

const hasCurrentPage = (c: { contextType: string; currentPagePath: string | null }): boolean =>
  // 0.1.79: `ask` (peer-consult) emits no `<current_*>` page block — it explores
  // the peer's spec headlessly, with no "current page" anchor.
  c.contextType !== 'ask' && c.currentPagePath !== null && c.currentPagePath !== '';

export const M02_PROMPT_BLOCKS: readonly PromptBlock[] = [
  {
    name: 'current_page',
    render: (c) =>
      hasCurrentPage(c) ? buildCurrentPage(c.currentPagePath!, c.currentPageBody, c.currentPageRootId) : null,
  },
  // The same gate as `<current_page>`: with no page open, the handling instruction
  // would have no subject.
  { name: 'current_page_handling', render: (c) => (hasCurrentPage(c) ? CURRENT_PAGE_HANDLING : null) },
];

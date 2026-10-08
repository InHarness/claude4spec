import type { ParsedArgs } from '../args.js';
import { requireString } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { serializePageStructure } from '../../../shared/section-parser.js';
import { CliError } from '../errors.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — `get_page` on the CLI: the whole page, when you really want all of it.
 *
 *   c4s get-page --root-id <id> --path <p> [--format text]
 *
 * 2.1.6 — the JSON output (pretty or `--compact`) is the core's envelope 1:1:
 * `{ rootId, path, hash, frontmatter?, preamble?, results[], truncated?, message? }`.
 * `--format text` assembles markdown from it by the section serializer's rule —
 * formatting for a human, not a second shape of the read. XML tags stay untouched
 * in either: a tag is the edge to another entity.
 *
 * 2.1.8 — there is no line window: every page root has a section index, so a
 * cut read resumes through `get-page-outline` + `get-sections`. A leftover
 * `--range` is refused rather than ignored — ignoring it would hand back the
 * whole page to a caller who believes it asked for twenty lines.
 *
 * 0.2.13 — `server-delegating`, over `GET /api/pages/:rootId/get?path=`. The
 * path travels as a QUERY parameter: it contains slashes, and the operation's
 * route must not be shadowable by a page whose name matches a static segment.
 */
export async function runGetPage(args: ParsedArgs): Promise<void> {
  const rootId = requireString(args, 'root-id');
  const pagePath = requireString(args, 'path');
  if (args.flags.has('range')) {
    throw new CliError(
      'INVALID_ARGS',
      'get-page has no line window (--range was removed in 2.1.8)',
      `c4s get-page-outline --root-id ${rootId} --path ${pagePath}, then c4s get-sections --anchors <a,b>`,
    );
  }

  const page = await delegateGet(args, `/pages/${encodeURIComponent(rootId)}/get`, { path: pagePath });
  if (args.format === 'text') {
    process.stdout.write(renderPageText(page as PageEnvelope));
    // The cut notice goes to stderr so stdout stays the page, pipeable as markdown.
    const message = (page as PageEnvelope).message;
    if (message) process.stderr.write(`${message}\n`);
    return;
  }
  writeOutput(page, args);
}

interface PageEnvelope {
  frontmatter?: { raw: string };
  preamble?: string;
  results: Array<{ anchor?: string; heading_text: string; heading_level: number; body?: string }>;
  message?: string;
}

/** `--format text` — the envelope assembled back into markdown (see `serializePageStructure`). */
export function renderPageText(page: PageEnvelope): string {
  return serializePageStructure({
    frontmatter: page.frontmatter?.raw ?? null,
    preamble: page.preamble ?? null,
    sections: page.results.map((i) => ({ anchor: i.anchor, level: i.heading_level, heading: i.heading_text, body: i.body })),
  });
}

export const getPageCommand: CliCommandContribution = {
  name: 'get-page',
  operation: 'get_page',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_ARGS', 'INVALID_ARGUMENT', 'PAGE_NOT_FOUND', 'ROOT_NOT_FOUND'],
  handler: runGetPage,
};

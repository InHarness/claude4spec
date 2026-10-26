import type { ParsedArgs } from '../args.js';
import { requireString } from '../args.js';
import { delegateOperation } from '../delegate.js';
import { writeOutput } from '../output.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.59 — `get_page_outline` on the CLI, replacing `list-sections`.
 *
 *   c4s get-page-outline --root-id <id> --path <p>
 *
 * ONE form, and every flag the old command carried is gone with it: no `--by`
 * discriminator, no `--anchor` variant, no `query` mode, and no `--limit`/`--offset`.
 * Pagination is absent on BOTH sides — the MCP tool has none either — because a
 * window into a tree returns nodes whose parents are missing, which is not a tree.
 * The valve is the response budget alone.
 *
 * `--root-id` is REQUIRED, with no quiet fallback onto the built-in `pages` root.
 * The identity regime is the one every page-keyed command follows: `list-pages`,
 * `get-page` and this one take the full `(rootId, path)` key, because the same
 * relative path can exist in several roots; `get-sections` keys a globally unique
 * anchor and takes no root at all.
 *
 * The output is a TREE in document order — a table of contents. Each node carries
 * the section's `anchor`, its heading, its level, the size of its own body, and
 * `children` only when it has any. `headingPath` is gone from the output: the
 * hierarchy is now the node's position in the tree.
 *
 * `server-delegating`. 2.1.53 — the operation has no REST channel, so it is
 * called by name over the project's MCP mount (`delegateOperation`); the page
 * router it used to borrow refused a bad root before the core could.
 */
export async function runGetPageOutline(args: ParsedArgs): Promise<void> {
  const rootId = requireString(args, 'root-id');
  const path = requireString(args, 'path');
  writeOutput(await delegateOperation(args, 'get_page_outline', { rootId, path }), args);
}

export const getPageOutlineCommand: CliCommandContribution = {
  name: 'get-page-outline',
  operation: 'get_page_outline',
  executionMode: 'server-delegating',
  flags: ['root-id', 'path'],
  errorCodes: ['INVALID_ARGS', 'INVALID_ARGUMENT', 'PAGE_NOT_FOUND'],
  handler: runGetPageOutline,
};

import type { ParsedArgs } from '../args.js';
import { optionalString, paginationFrom, requireString } from '../args.js';
import { delegateOperation } from '../delegate.js';
import { writeOutput } from '../output.js';
import { CliError } from '../errors.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — `list_pages` on the CLI.
 *
 *   c4s list-pages --root-id <id> [--prefix <p>] [--sort path|modified]
 *                  [--limit <n>] [--offset <n>]
 *
 * `--root-id` is REQUIRED and there is no fallback to the built-in root: the
 * same relative path can exist in several roots, so a bare path is ambiguous,
 * and the old page API turned that ambiguity into a confident answer from the
 * wrong directory. Each row carries the title, section count, size and mtime —
 * measurement before fetching.
 *
 * 0.2.13 — `server-delegating`. 2.1.53 — it reaches the core operation
 * `list_pages` by name over the project's MCP mount (see `delegateOperation`),
 * not the M02 page router: an unknown or system `--root-id` is the core's
 * `INVALID_ARGUMENT` with the `kind: pages` roots in `message`.
 */
export async function runListPages(args: ParsedArgs): Promise<void> {
  const rootId = requireString(args, 'root-id');
  const prefix = optionalString(args, 'prefix');
  const rawSort = optionalString(args, 'sort');
  if (rawSort !== undefined && rawSort !== 'path' && rawSort !== 'modified') {
    throw new CliError('INVALID_ARGS', `--sort must be 'path' or 'modified', got '${rawSort}'`);
  }

  writeOutput(
    await delegateOperation(args, 'list_pages', { rootId, prefix, sort: rawSort, ...paginationFrom(args) }),
    args,
  );
}

export const listPagesCommand: CliCommandContribution = {
  name: 'list-pages',
  operation: 'list_pages',
  executionMode: 'server-delegating',
  flags: ['root-id', 'prefix', 'sort', 'limit', 'offset'],
  // 2.1.26 (M11 `m11dcmds`) — no `PAGE_NOT_FOUND`: a listing addresses a root,
  // not a page, so there is no `(rootId, path)` for it to miss. An unknown root
  // is the core's `INVALID_ARGUMENT` (2.1.53); `PAGE_NOT_FOUND` belongs to the
  // page reads.
  errorCodes: ['INVALID_ARGS', 'INVALID_ARGUMENT'],
  handler: runListPages,
};

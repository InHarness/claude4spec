import type { ParsedArgs } from '../args.js';
import { optionalString, paginationFrom, requireString } from '../args.js';
import { delegateGet } from '../delegate.js';
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
 * 0.2.13 — `server-delegating`, over `GET /api/pages/:rootId/list`. That is the
 * core's flat, paged projection; `GET /api/pages/:rootId` keeps answering the
 * sidebar's tree.
 */
export async function runListPages(args: ParsedArgs): Promise<void> {
  const rootId = requireString(args, 'root-id');
  const prefix = optionalString(args, 'prefix');
  const rawSort = optionalString(args, 'sort');
  if (rawSort !== undefined && rawSort !== 'path' && rawSort !== 'modified') {
    throw new CliError('INVALID_ARGS', `--sort must be 'path' or 'modified', got '${rawSort}'`);
  }

  writeOutput(
    await delegateGet(args, `/pages/${encodeURIComponent(rootId)}/list`, {
      prefix,
      sort: rawSort,
      ...paginationFrom(args),
    }),
    args,
  );
}

export const listPagesCommand: CliCommandContribution = {
  name: 'list-pages',
  operation: 'list_pages',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_ARGS', 'INVALID_ARGUMENT', 'PAGE_NOT_FOUND', 'ROOT_NOT_FOUND'],
  handler: runListPages,
};

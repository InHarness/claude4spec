import type { ParsedArgs } from '../args.js';
import { optionalString, paginationFrom, requireString } from '../args.js';
import { createContext } from '../context.js';
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
 */
export async function runListPages(args: ParsedArgs): Promise<void> {
  const rootId = requireString(args, 'root-id');
  const prefix = optionalString(args, 'prefix');
  const rawSort = optionalString(args, 'sort');
  if (rawSort !== undefined && rawSort !== 'path' && rawSort !== 'modified') {
    throw new CliError('INVALID_ARGS', `--sort must be 'path' or 'modified', got '${rawSort}'`);
  }

  const ctx = await createContext(args);
  try {
    writeOutput(
      await ctx.discovery.listPages({
        rootId,
        ...(prefix ? { prefix } : {}),
        ...(rawSort ? { sort: rawSort } : {}),
        ...paginationFrom(args),
      }),
      args,
    );
  } finally {
    ctx.close();
  }
}

export const listPagesCommand: CliCommandContribution = {
  name: 'list-pages',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_ARGS', 'INVALID_ARGUMENT', 'PAGE_NOT_FOUND'],
  handler: runListPages,
};

import type { ParsedArgs } from '../args.js';
import { optionalString, paginationFrom, requireString } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { CliError } from '../errors.js';
import type { ListSectionsInput } from '../../../server/discovery/types.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — `list_sections` on the CLI, over the same DISCRIMINATED UNION the core
 * takes.
 *
 *   c4s list-sections --by page   --root-id <id> --path <p>
 *   c4s list-sections --by anchor --anchor <a>
 *
 * There is no `--by query` and there will not be one: a heading substring is not
 * an identity, so a fuzzy mode here would mix identity regimes and leak search
 * into a traversal. The path from a phrase is explicit — `search-pages` to find
 * a hit, then `--by anchor`.
 *
 * The two modes key DIFFERENTLY, and that is the point. A page is `(rootId,
 * path)`; an anchor is globally unique, so the anchor mode takes no root at all
 * — accepting one would invite the belief that anchors are scoped.
 */
export async function runListSections(args: ParsedArgs): Promise<void> {
  const by = optionalString(args, 'by');
  if (by !== 'page' && by !== 'anchor') {
    throw new CliError(
      'INVALID_ARGS',
      `--by must be 'page' or 'anchor'${by ? `, got '${by}'` : ''}`,
      "c4s list-sections --by page --root-id <id> --path <p> | c4s list-sections --by anchor --anchor <a>",
    );
  }

  const input: ListSectionsInput =
    by === 'anchor'
      ? { by: 'anchor', anchor: requireSectionKey(args, 'anchor') }
      : { by: 'page', rootId: requireString(args, 'root-id'), path: requireString(args, 'path') };

  const ctx = await createContext(args);
  try {
    writeOutput(await ctx.discovery.listSections({ ...input, ...paginationFrom(args) }), args);
  } finally {
    ctx.close();
  }
}

/**
 * Reads the anchor and REFUSES a `--root-id` alongside it.
 *
 * Silently ignoring the flag would leave a caller believing the listing had been
 * scoped to that root when it never was — the failure mode is a confident wrong
 * answer, which is worse than the typo.
 */
export function requireSectionKey(args: ParsedArgs, flag: string): string {
  if (args.flags.has('root-id')) {
    throw new CliError(
      'INVALID_ARGUMENT',
      'section commands take no --root-id: an anchor is globally unique',
      'drop --root-id; use --by page --root-id <id> --path <p> to list a page instead',
    );
  }
  return requireString(args, flag);
}

export const listSectionsCommand: CliCommandContribution = {
  name: 'list-sections',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_ARGS', 'INVALID_ARGUMENT', 'PAGE_NOT_FOUND'],
  handler: runListSections,
};

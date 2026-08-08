import type { ParsedArgs } from '../args.js';
import { optionalString, paginationFrom, requireString } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { CliError } from '../errors.js';
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
 *
 * 0.2.13 — `server-delegating`, over `GET /api/sections/list`. The discriminant
 * travels as `by=`, so the wire carries the same union the core takes rather
 * than a flattened bag of optional fields the server would have to re-discriminate.
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

  const key =
    by === 'anchor'
      ? { by, anchor: requireSectionKey(args, 'anchor') }
      : { by, rootId: requireString(args, 'root-id'), path: requireString(args, 'path') };

  writeOutput(await delegateGet(args, '/sections/list', { ...key, ...paginationFrom(args) }), args);
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
  operation: 'list_sections',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_ARGS', 'INVALID_ARGUMENT', 'PAGE_NOT_FOUND'],
  handler: runListSections,
};

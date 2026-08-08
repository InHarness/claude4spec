import type { ParsedArgs } from '../args.js';
import { optionalString, paginationFrom } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { CliError } from '../errors.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — `search_pages` on the CLI: the entry point of the "I have a phrase →
 * I have the text" path.
 *
 *   c4s search-pages (--query <q> | --regex <r>) [--root-id <id>]
 *                    [--mode hits|pages|count] [--limit <n>] [--offset <n>]
 *
 * A hit on a section-indexed root carries an `anchor`, which is what makes
 * `list-sections --by anchor` and `get-sections` reachable from a phrase. On a
 * root without a section index it degrades to `(rootId, path, line)` — a
 * DISCRIMINATED union, so the two are never confused for one another.
 *
 * 0.2.13 — `server-delegating`, over `GET /api/pages/search`. Cross-root, so it
 * mounts WITHOUT a root segment (`--root-id` only narrows it) — and ahead of
 * `/pages/:rootId`, or `search` would be read as a root id.
 */
export async function runSearchPages(args: ParsedArgs): Promise<void> {
  const query = optionalString(args, 'query');
  const regex = optionalString(args, 'regex');
  if (query && regex) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '--query and --regex are alternatives, not a refinement of one another',
      'pass one of them: --query "<phrase>" for a text search, --regex "<pattern>" for a pattern',
    );
  }
  if (!query && !regex) {
    throw new CliError('INVALID_ARGS', 'search-pages requires --query or --regex');
  }

  const rawMode = optionalString(args, 'mode');
  if (rawMode !== undefined && rawMode !== 'hits' && rawMode !== 'pages' && rawMode !== 'count') {
    throw new CliError('INVALID_ARGS', `--mode must be 'hits', 'pages' or 'count', got '${rawMode}'`);
  }
  const rootId = optionalString(args, 'root-id');

  writeOutput(
    await delegateGet(args, '/pages/search', {
      q: query,
      regex,
      rootId,
      mode: rawMode,
      ...paginationFrom(args),
    }),
    args,
  );
}

export const searchPagesCommand: CliCommandContribution = {
  name: 'search-pages',
  operation: 'search_pages',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_ARGS', 'INVALID_ARGUMENT'],
  handler: runSearchPages,
};

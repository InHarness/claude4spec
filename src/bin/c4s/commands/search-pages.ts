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
 *                    [--mode count|map|hits] [--path-include <re>] [--path-exclude <re>]
 *                    [--anchors <a1,a2>] [--context <n>] [--limit <n>] [--offset <n>]
 *
 * A hit on a section-indexed root carries an `anchor`, which is what makes
 * `list-sections --by anchor` and `get-sections` reachable from a phrase. On a
 * root without a section index it collapses per PAGE and carries no anchor.
 *
 * 0.2.40 — `--mode pages` is GONE and the default is `map`, not `hits`. A
 * script that relied on the old default now gets identity rows instead of prose
 * and must pass `--mode hits` to get it back; one that passed `--mode pages` is
 * refused outright rather than quietly answered with something else.
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
  if (rawMode !== undefined && rawMode !== 'hits' && rawMode !== 'map' && rawMode !== 'count') {
    throw new CliError(
      'INVALID_ARGS',
      `--mode must be 'count', 'map' or 'hits', got '${rawMode}'`,
      rawMode === 'pages'
        ? "'pages' was removed in 0.2.40 — use 'map' for identity rows, then get-sections on an anchor to read one"
        : "the ladder is count (totals) -> map (identity, the default) -> hits (adds prose)",
    );
  }
  const rootId = optionalString(args, 'root-id');
  const context = optionalString(args, 'context');

  writeOutput(
    await delegateGet(args, '/pages/search', {
      q: query,
      regex,
      rootId,
      mode: rawMode,
      pathInclude: optionalString(args, 'path-include'),
      pathExclude: optionalString(args, 'path-exclude'),
      anchors: optionalString(args, 'anchors'),
      context,
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

import type { ParsedArgs } from '../args.js';
import {
  assertFlagSet,
  optionalInt,
  optionalRawStringList,
  paginationFrom,
  repeatedStrings,
  requireString,
} from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { cliReleasePayload } from '../release-hint.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 *   c4s release-diff --from <name|initial|null> --to <name|current>
 *                    [--include …] [--entity-types …] [--slugs …] [--roots …] [--paths <p> …]
 *                    [--summary-only] [--section-offset N] [--section-limit N] [--limit N] [--offset N]
 *
 * 2.1.11 — renders the `release_diff` operation 1:1, `server-delegating` over
 * `GET /api/releases/<from>/diff/<to>?view=operation`, and prints the operation
 * payload (`MCPReleaseDiff`): `c4s release-diff --from A --to B` is
 * `release_diff(A, B)`.
 *
 * The flag set is the operation's parameter set, camelCase → kebab-case, with
 * `fromReleaseName` → `--from` and `toReleaseName` → `--to`. Lists are
 * comma-separated and travel with their empty elements; `--paths` repeats. No
 * filter is validated here and no window logic lives here: the only local
 * refusal is an unknown or missing flag (`INVALID_ARGUMENT`, nothing sent).
 * When the budget cut the answer, `truncationHint` comes back in flag form —
 * runnable as the next `c4s release-diff` call.
 */
export async function runReleaseDiff(args: ParsedArgs): Promise<void> {
  assertFlagSet(args, 'release-diff', {
    required: ['from', 'to'],
    optional: [
      'include',
      'entity-types',
      'slugs',
      'roots',
      'paths',
      'summary-only',
      'section-offset',
      'section-limit',
      'limit',
      'offset',
    ],
  });
  const from = requireString(args, 'from');
  const to = requireString(args, 'to');
  const sectionOffset = optionalInt(args, 'section-offset');
  const sectionLimit = optionalInt(args, 'section-limit');
  const data = (await delegateGet(
    args,
    `/releases/${encodeURIComponent(from)}/diff/${encodeURIComponent(to)}`,
    {
      view: 'operation',
      include: optionalRawStringList(args, 'include'),
      entityTypes: optionalRawStringList(args, 'entity-types'),
      slugs: optionalRawStringList(args, 'slugs'),
      roots: optionalRawStringList(args, 'roots'),
      paths: repeatedStrings(args, 'paths'),
      summaryOnly: args.flags.get('summary-only') === true ? true : undefined,
      sectionOffset,
      sectionLimit,
      ...paginationFrom(args),
    },
    { lists: 'repeat' },
  )) as { truncationHint?: string };
  writeOutput(cliReleasePayload(data), args);
}

export const releaseDiffCommand: CliCommandContribution = {
  name: 'release-diff',
  operation: 'release_diff',
  executionMode: 'server-delegating',
  errorCodes: [
    ...SERVER_DELEGATING_CODES,
    'INVALID_ARGS',
    'INVALID_ARGUMENT',
    'RELEASE_NOT_FOUND',
    'INVALID_INCLUDE_FILTER',
    'INVALID_ENTITY_TYPES_FILTER',
    'INVALID_SLUGS_FILTER',
    'INVALID_PATHS_FILTER',
    'INVALID_ROOTS_FILTER',
    'CONFLICTING_FILTERS',
    'INVALID_PAGINATION',
    'INVALID_DIFF_RANGE',
  ],
  handler: runReleaseDiff,
};

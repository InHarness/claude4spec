import type { ParsedArgs } from '../args.js';
import { assertFlagSet, optionalRawStringList, paginationFrom, requireString } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { cliReleasePayload } from '../release-hint.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 *   c4s release-show --release <name> [--include …] [--entity-types …] [--limit N] [--offset N]
 *
 * 2.1.11 — renders the `release_show` operation 1:1, `server-delegating` over
 * `GET /api/releases/<name>/snapshot?view=operation`. Prints the operation
 * payload (`MCPSpecSnapshot`).
 *
 * The binary validates no filter: lists go to the server as written (empty
 * elements included) and its refusal comes back with the server's own code.
 * `--release` is percent-encoded as one path segment and never interpreted —
 * a literal such as `current` reaches the server, which answers for it.
 */
export async function runReleaseShow(args: ParsedArgs): Promise<void> {
  assertFlagSet(args, 'release-show', {
    required: ['release'],
    optional: ['include', 'entity-types', 'limit', 'offset'],
  });
  const release = requireString(args, 'release');
  const data = (await delegateGet(
    args,
    `/releases/${encodeURIComponent(release)}/snapshot`,
    {
      view: 'operation',
      include: optionalRawStringList(args, 'include'),
      entityTypes: optionalRawStringList(args, 'entity-types'),
      ...paginationFrom(args),
    },
    { lists: 'repeat' },
  )) as { truncationHint?: string };
  writeOutput(cliReleasePayload(data), args);
}

export const releaseShowCommand: CliCommandContribution = {
  name: 'release-show',
  operation: 'release_show',
  executionMode: 'server-delegating',
  errorCodes: [
    ...SERVER_DELEGATING_CODES,
    'INVALID_ARGS',
    'INVALID_ARGUMENT',
    'RELEASE_NOT_FOUND',
    'INVALID_INCLUDE_FILTER',
    'INVALID_ENTITY_TYPES_FILTER',
    'CONFLICTING_FILTERS',
    'INVALID_PAGINATION',
  ],
  handler: runReleaseShow,
};

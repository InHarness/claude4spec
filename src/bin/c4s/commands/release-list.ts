import type { ParsedArgs } from '../args.js';
import { assertFlagSet, paginationFrom } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 *   c4s release-list [--limit N] [--offset N]
 *
 * 2.1.11 — renders the `release_list` operation 1:1, `server-delegating` over
 * `GET /api/releases?view=operation`. It prints the operation payload
 * `{ releases, total }` — the same one `release_list()` returns over MCP.
 *
 * The window is the OPERATION's (default 5, no upper bound): `--limit` /
 * `--offset` travel only when given, so the core's default stands otherwise.
 */
export async function runReleaseList(args: ParsedArgs): Promise<void> {
  assertFlagSet(args, 'release-list', { required: [], optional: ['limit', 'offset'] });
  const data = await delegateGet(args, '/releases', { view: 'operation', ...paginationFrom(args) });
  writeOutput(data, args);
}

export const releaseListCommand: CliCommandContribution = {
  name: 'release-list',
  operation: 'release_list',
  executionMode: 'server-delegating',
  errorCodes: [...SERVER_DELEGATING_CODES, 'INVALID_ARGS', 'INVALID_ARGUMENT', 'INVALID_PAGINATION'],
  handler: runReleaseList,
};

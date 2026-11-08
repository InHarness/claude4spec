import type { ParsedArgs } from '../args.js';
import { optionalInt, optionalString } from '../args.js';
import { delegateGet } from '../delegate.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { DEFAULT_LIMITS, MAX_LIMIT } from '../../../server/discovery/pagination.js';
import type { ArtifactListItem } from '../../../shared/entities.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 *   c4s list-patches [--limit N] [--offset M] [--status <applied|pending>] [--brief <brief-path>]
 *
 * 2.1.74 (M23 `h0njz264`) — the `cli` rendering of the catalog operation
 * `list_patches`, `server-delegating` over `GET /api/artifacts/patch`. Zero patch
 * logic in the bin: that route's patch adapter calls `PatchService.listPatches`,
 * the same function the `transagent-tools · list_patches` tool calls, so the
 * filter semantics (a brief resolved from frontmatter or file-name prefix, a
 * missing `applied` counted as `false`) and the ORDER (`created_at` ascending,
 * ties by `path`, undated last by `path`) are the server's. This command must
 * not filter or sort.
 *
 * - `--brief <brief-path>` (relative to the briefs root, as in `create-patch`)
 *   → `?brief=`; a brief that does not exist is an empty list, not a refusal.
 * - `--status applied` → `?applied=true`, `--status pending` → `?applied=false`.
 *   Any other value is refused here, before addressing the server, with the
 *   same `VALIDATION` code the server would answer — but in the flag's terms
 *   (`--status` and `applied|pending`), not the route's `?applied=true|false`.
 *
 * The window is the operation's (M39 implicit matrix: default `limit` 50,
 * ceiling 1000, `offset` 0). The route answers the whole filtered, sorted set,
 * so the window lands here on that list: `total` counts it before the window and
 * `hasMore` says whether rows remain after it — pages concatenate into the full
 * order. Each row is the route's `ArtifactListItem` untouched (`path` relative
 * to the patches root, `applied` inside `frontmatter`).
 */
export async function runListPatches(args: ParsedArgs): Promise<void> {
  const rawLimit = optionalInt(args, 'limit');
  if (rawLimit !== undefined && rawLimit <= 0) {
    throw new CliError('INVALID_ARGS', '--limit must be > 0');
  }
  const offset = optionalInt(args, 'offset') ?? 0;
  if (offset < 0) {
    throw new CliError('INVALID_ARGS', '--offset must be >= 0');
  }
  const limit = Math.min(rawLimit ?? DEFAULT_LIMITS.listPatches, MAX_LIMIT);

  const status = optionalString(args, 'status');
  if (status !== undefined && status !== 'applied' && status !== 'pending') {
    throw new CliError('VALIDATION', `--status must be 'applied' or 'pending', got '${status}'`);
  }
  const applied = status === undefined ? undefined : status === 'applied' ? 'true' : 'false';
  const brief = optionalString(args, 'brief');

  const rows = (await delegateGet(args, '/artifacts/patch', {
    ...(brief === undefined ? {} : { brief }),
    ...(applied === undefined ? {} : { applied }),
  })) as ArtifactListItem[];

  const items = rows.slice(offset, offset + limit);
  writeOutput({ items, total: rows.length, hasMore: offset + items.length < rows.length }, args);
}

export const listPatchesCommand: CliCommandContribution = {
  name: 'list-patches',
  operation: 'list_patches',
  executionMode: 'server-delegating',
  flags: ['brief', 'status', 'limit', 'offset'],
  errorCodes: [...SERVER_DELEGATING_CODES, 'INVALID_ARGS'],
  handler: runListPatches,
};

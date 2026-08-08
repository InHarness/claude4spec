import type { ParsedArgs } from '../args.js';
import { optionalInt, optionalString } from '../args.js';
import { delegateGet } from '../delegate.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import type { BriefFrontmatterRaw } from '../../../core/briefs/index.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 *   c4s list-briefs [--limit N] [--offset M] [--status implemented|pending]
 *
 * 0.2.13 — `server-delegating`, over `GET /api/artifacts/brief`. It used to walk
 * `briefsDir` itself and parse every frontmatter, which worked without a server
 * and is exactly the local specification read item 22 removes.
 *
 * The ORDER improves as a side effect, and that is worth stating rather than
 * discovering. The filesystem path sorted by `to_release desc` with analysis
 * briefs first — its own comment called that "an approximation of the UI's
 * canonical `spec_release` order, which this FS-only path cannot consult without
 * SQLite". Delegating consults it. The two orders differ for releases the UI's
 * list knows and a string compare does not.
 *
 * `--status` maps to the route's `?implemented=`; the window is applied here,
 * because that route answers the whole set by design (a project has tens of
 * briefs, not thousands) and paging it server-side would be a second contract
 * for the UI to keep.
 */
export async function runListBriefs(args: ParsedArgs): Promise<void> {
  const limit = optionalInt(args, 'limit');
  if (limit !== undefined && limit <= 0) {
    throw new CliError('INVALID_ARGS', '--limit must be > 0');
  }
  const offset = optionalInt(args, 'offset');
  if (offset !== undefined && offset < 0) {
    throw new CliError('INVALID_ARGS', '--offset must be >= 0');
  }
  const status = optionalString(args, 'status');
  if (status !== undefined && status !== 'implemented' && status !== 'pending') {
    throw new CliError('INVALID_ARGS', `--status must be 'implemented' or 'pending', got '${status}'`);
  }

  const rows = (await delegateGet(args, '/artifacts/brief', {
    ...(status === undefined ? {} : { implemented: status === 'implemented' ? 'true' : 'false' }),
  })) as Array<{ path: string; frontmatter: BriefFrontmatterRaw }>;

  const all = rows.map((r) => ({
    path: r.path,
    frontmatter: r.frontmatter,
    implemented: r.frontmatter?.implemented === true,
  }));
  const start = offset ?? 0;
  const items = limit === undefined ? all.slice(start) : all.slice(start, start + limit);
  writeOutput({ items, total: all.length }, args);
}

export const listBriefsCommand: CliCommandContribution = {
  name: 'list-briefs',
  operation: 'list_briefs',
  executionMode: 'server-delegating',
  errorCodes: [...SERVER_DELEGATING_CODES, 'INVALID_ARGS'],
  handler: runListBriefs,
};

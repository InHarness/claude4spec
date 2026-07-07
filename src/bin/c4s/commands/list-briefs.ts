import type { ParsedArgs } from '../args.js';
import { optionalInt, optionalString } from '../args.js';
import { resolveBriefsPatchesDirs } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { listBriefsFs } from '../../../core/briefs/index.js';
import type { BriefListOpts } from '../../../core/briefs/index.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.1.103 M11 — filesystem-only, no server/sqlite. Resolves the project via
 * the registry (`resolveBriefsPatchesDirs`, NOT `createContext`, which opens
 * db.sqlite) so this works under `INDEX_NOT_MATERIALIZED` and from any cwd
 * once `--project <slug> --workspace <name>` is supplied.
 *
 *   c4s list-briefs [--limit N] [--offset M] [--status implemented|pending] [--format json|text]
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

  const { briefsDirAbs } = resolveBriefsPatchesDirs(args);

  const opts: BriefListOpts = { limit, offset, status };
  writeOutput(listBriefsFs(briefsDirAbs, opts), args);
}

export const listBriefsCommand: CliCommandContribution = {
  name: 'list-briefs',
  executionMode: 'fs-scoped',
  errorCodes: ['INVALID_ARGS'],
  handler: runListBriefs,
};

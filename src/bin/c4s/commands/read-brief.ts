import type { ParsedArgs } from '../args.js';
import { resolveBriefsPatchesDirs } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { readBriefFs, BriefFsError } from '../../../core/briefs/index.js';

/**
 * 0.1.103 M11 — filesystem-only, no server/sqlite. `<brief-path>` is relative
 * to `briefsDir` (parity with the `--brief` argument elsewhere), guarded
 * against path traversal (INVALID_ARGS) inside `readBriefFs`.
 *
 *   c4s read-brief <brief-path> [--format json|text]
 */
export async function runReadBrief(args: ParsedArgs): Promise<void> {
  const briefPath = args.positional[0];
  if (!briefPath) {
    throw new CliError(
      'INVALID_ARGS',
      'read-brief requires a brief path',
      'usage: c4s read-brief <brief-path>',
    );
  }

  const { briefsDirAbs } = resolveBriefsPatchesDirs(args);

  try {
    writeOutput(readBriefFs(briefsDirAbs, briefPath), args);
  } catch (err) {
    if (err instanceof BriefFsError) {
      throw new CliError(err.code, err.message, err.hint);
    }
    throw err;
  }
}

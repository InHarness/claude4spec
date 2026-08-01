import type { ParsedArgs } from '../args.js';
import { optionalStringList, refuseFlags } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { CliError } from '../errors.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — `get_sections` on the CLI: the bodies of several sections in ONE call.
 *
 *   c4s get-sections --anchors <a,b,c> [--include-subtree]
 *
 * Two properties a caller has to be able to rely on:
 *
 * 1. An unknown anchor comes back as an error INSIDE ITS OWN ITEM, and the exit
 *    code stays ZERO. One bad anchor must not lose the other sections — that is
 *    the entire reason the operation is batched, and a non-zero exit would make
 *    every shell caller throw the good results away.
 * 2. No `--root-id`, and no `--limit`/`--offset`. Anchors are globally unique,
 *    and the caller named the rows, so the valve is the input-length cap plus
 *    the response budget.
 */
export async function runGetSections(args: ParsedArgs): Promise<void> {
  if (args.flags.has('root-id')) {
    throw new CliError(
      'INVALID_ARGUMENT',
      'get-sections takes no --root-id: an anchor is globally unique',
      'c4s get-sections --anchors <a,b,c>',
    );
  }
  /**
   * An empty list is NOT refused here. The core refuses it with the operative
   * limit in the message ("1..50"), and a local "--anchors is required" would
   * answer the same mistake with less information — the caller who passed an
   * empty list is exactly the one who needs to be told what the bounds are.
   */
  const anchors = optionalStringList(args, 'anchors') ?? [];
  const includeSubtree = args.flags.get('include-subtree') === true || args.flags.get('include-subtree') === 'true';

  refuseFlags(args, ['limit', 'offset'], 'get-sections is fetch-by-key: you name the rows, so the valve is the anchor-list cap plus the response budget');

  const ctx = await createContext(args);
  try {
    writeOutput(await ctx.discovery.getSections({ anchors, includeSubtree }), args);
  } finally {
    ctx.close();
  }
}

export const getSectionsCommand: CliCommandContribution = {
  name: 'get-sections',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_ARGS', 'INVALID_ARGUMENT', 'SECTION_NOT_FOUND'],
  handler: runGetSections,
};

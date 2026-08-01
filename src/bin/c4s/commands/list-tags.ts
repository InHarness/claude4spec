import type { ParsedArgs } from '../args.js';
import { optionalInt, optionalString, paginationFrom } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — through the CORE, not straight off the reader.
 *
 * This command used to call `reader.listTags()`, so it was the `list_tags`
 * operation in name only: no pagination, no `withCounts` gate, no
 * `coOccurringWith`. A caller who read the operation's contract and then ran the
 * command got a different answer than the contract described — and the flags the
 * contract names simply did nothing.
 *
 *   c4s list-tags [--with-counts] [--min-count <n>] [--co-occurring-with <slug>]
 *                 [--limit <n>] [--offset <n>]
 *
 * `--with-counts` is off by default because full counts are a cartesian product
 * of tags by active types.
 */
export async function runListTags(args: ParsedArgs): Promise<void> {
  const withCounts = args.flags.get('with-counts') === true || args.flags.get('with-counts') === 'true';
  const minCount = optionalInt(args, 'min-count');
  const coOccurringWith = optionalString(args, 'co-occurring-with');

  const ctx = await createContext(args);
  try {
    writeOutput(
      ctx.discovery.listTags({
        withCounts,
        ...(minCount === undefined ? {} : { minCount }),
        ...(coOccurringWith ? { coOccurringWith } : {}),
        ...paginationFrom(args),
      }),
      args,
    );
  } finally {
    ctx.close();
  }
}

export const listTagsCommand: CliCommandContribution = {
  name: 'list-tags',
  executionMode: 'readonly-reader',
  errorCodes: [],
  handler: runListTags,
};

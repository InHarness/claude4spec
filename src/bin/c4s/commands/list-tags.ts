import type { ParsedArgs } from '../args.js';
import { optionalInt, optionalString, paginationFrom } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — through the CORE, not straight off the reader.
 *
 *   c4s list-tags [--with-counts] [--min-count <n>] [--co-occurring-with <slug>]
 *                 [--limit <n>] [--offset <n>]
 *
 * `--with-counts` is off by default because full counts are a cartesian product
 * of tags by active types.
 *
 * 0.2.13 — `server-delegating`, over `GET /api/tags/list`. That is the CORE's
 * projection, deliberately a separate path from `GET /api/tags`, which serves
 * the UI's published `Tag` DTO and orders by name.
 */
export async function runListTags(args: ParsedArgs): Promise<void> {
  const withCounts = args.flags.get('with-counts') === true || args.flags.get('with-counts') === 'true';
  const minCount = optionalInt(args, 'min-count');
  const coOccurringWith = optionalString(args, 'co-occurring-with');

  writeOutput(
    await delegateGet(args, '/tags/list', {
      withCounts,
      minCount,
      coOccurringWith,
      ...paginationFrom(args),
    }),
    args,
  );
}

export const listTagsCommand: CliCommandContribution = {
  name: 'list-tags',
  operation: 'list_tags',
  executionMode: 'server-delegating',
  errorCodes: [],
  handler: runListTags,
};

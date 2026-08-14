import type { ParsedArgs } from '../args.js';
import { optionalString, requireString, requireStringList } from '../args.js';
import { delegateGetAll } from '../delegate.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { pickEntityPage } from './_meta.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.13 — `server-delegating`, over `GET /api/entities/:type/list`.
 *
 * `tagged_list` is an UNBOUNDED tag traversal on the CLI, where the consumer is
 * a human or a shell pipeline rather than a context window — so it exhausts the
 * pages rather than taking the first one and calling it the answer. In-process
 * that was `listEntitiesAll`; over HTTP it is the same sweep as a `limit`/
 * `offset` loop. The move is transport, not semantics: same operation, same
 * rows, fetched over a wire.
 */
export async function runTaggedList(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const tags = requireStringList(args, 'tags');
  /**
   * 0.2.22 — `--tag-filter`, the spelling the operation itself uses, with
   * `--filter` still accepted so an existing pipeline keeps working.
   *
   * The wire key moved with it. Sending the old `filter=` to a server that only
   * reads `tagFilter` was worse than an error: the core fell back to its own
   * default and quietly answered the INTERSECTION to a command that had asked
   * for the union.
   */
  const filterRaw = optionalString(args, 'tag-filter') ?? optionalString(args, 'filter') ?? 'or';
  if (filterRaw !== 'and' && filterRaw !== 'or') {
    throw new CliError('INVALID_ARGS', `--tag-filter must be 'and' or 'or', got '${filterRaw}'`);
  }

  const { items, exhausted } = await delegateGetAll(
    args,
    `/entities/${type}/list`,
    { tags, tagFilter: filterRaw },
    pickEntityPage,
  );
  /**
   * `hasMore` is REPORTED, not assumed false.
   *
   * The sweep normally runs to the end and answers false. But `delegateGetAll`
   * has a runaway guard, and a command that discards `exhausted` prints a list
   * cut at the guard as though it were the whole answer — which is the wrong
   * answer that reads like a right one, and precisely what this command exists
   * not to give. `find-references` has always reported it; these did not.
   */
  writeOutput(
    { items, hasMore: !exhausted, query: { type, tags, tagFilter: filterRaw } },
    args,
  );
}

export const taggedListCommand: CliCommandContribution = {
  name: 'tagged_list',
  operation: 'list_entities',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS'],
  handler: runTaggedList,
};

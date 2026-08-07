import type { ParsedArgs } from '../args.js';
import { optionalString, requireString, requireStringList } from '../args.js';
import { delegateGetAll } from '../delegate.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { withMeta } from './_meta.js';
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
  const filterRaw = optionalString(args, 'filter') ?? 'or';
  if (filterRaw !== 'and' && filterRaw !== 'or') {
    throw new CliError('INVALID_ARGS', `--filter must be 'and' or 'or', got '${filterRaw}'`);
  }

  const { items } = await delegateGetAll(
    args,
    `/entities/${type}/list`,
    { tags, filter: filterRaw, view: 'tagged_list_item' },
    pickEntityPage,
  );
  writeOutput({ items: items.map(withMeta), query: { type, tags, filter: filterRaw } }, args);
}

export const taggedListCommand: CliCommandContribution = {
  name: 'tagged_list',
  operation: 'list_entities',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS'],
  handler: runTaggedList,
};

import type { ParsedArgs } from '../args.js';
import { optionalString, requireString, requireStringList } from '../args.js';
import { createContext } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { withMeta } from './_meta.js';
import { listEntitiesAll } from '../../../server/discovery/index.js';
import type { CliCommandContribution } from '../registry.js';

export async function runTaggedList(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const tags = requireStringList(args, 'tags');
  const filterRaw = optionalString(args, 'filter') ?? 'or';
  if (filterRaw !== 'and' && filterRaw !== 'or') {
    throw new CliError('INVALID_ARGS', `--filter must be 'and' or 'or', got '${filterRaw}'`);
  }
  const ctx = await createContext(args);
  try {
    // `tagged_list` is an unbounded tag traversal on the CLI, where the consumer
    // is a human or a shell pipeline rather than a context window — so it
    // exhausts the core's pages rather than taking the first one and calling it
    // the answer.
    const items = listEntitiesAll(ctx.discovery, {
      type,
      tags,
      filter: filterRaw,
      view: 'tagged_list_item',
    }).map(withMeta);
    writeOutput({ items, query: { type, tags, filter: filterRaw } }, args);
  } finally {
    ctx.close();
  }
}

export const taggedListCommand: CliCommandContribution = {
  name: 'tagged_list',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS'],
  handler: runTaggedList,
};

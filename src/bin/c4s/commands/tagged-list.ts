import type { ParsedArgs } from '../args.js';
import { optionalString, requireString, requireStringList } from '../args.js';
import { createContext } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { withMeta } from './_meta.js';
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
    // is a human or a shell pipeline rather than a context window — so it asks
    // the core for the whole set explicitly instead of silently taking page one.
    const result = ctx.discovery.listEntities({
      type,
      tags,
      filter: filterRaw,
      view: 'tagged_list_item',
      limit: 1000,
    });
    const items = result.mode === 'items' ? result.items.map(withMeta) : [];
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

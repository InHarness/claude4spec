import type { ParsedArgs } from '../args.js';
import { optionalString, requireString, requireStringList } from '../args.js';
import { createContext } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { withMeta } from './_meta.js';

export async function runTaggedList(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const tags = requireStringList(args, 'tags');
  const filterRaw = optionalString(args, 'filter') ?? 'or';
  if (filterRaw !== 'and' && filterRaw !== 'or') {
    throw new CliError('INVALID_ARGS', `--filter must be 'and' or 'or', got '${filterRaw}'`);
  }
  const ctx = await createContext(args);
  try {
    const entities = ctx.reader.findByTag({ type, tags, filter: filterRaw });
    const items = entities.map((entity) =>
      withMeta(ctx.registry.serializeEntity(type, 'tagged_list_item', entity, ctx.reader))
    );
    writeOutput({ items, query: { type, tags, filter: filterRaw } }, args);
  } finally {
    ctx.close();
  }
}

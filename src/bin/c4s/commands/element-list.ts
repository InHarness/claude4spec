import type { ParsedArgs } from '../args.js';
import { requireString, requireStringList } from '../args.js';
import { createContext } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { withMeta } from './_meta.js';
import type { CliCommandContribution } from '../registry.js';

export async function runElementList(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slugs = requireStringList(args, 'slugs');
  const ctx = await createContext(args);
  try {
    const { items: entities, missing } = ctx.reader.getEntities(type, slugs);
    if (entities.length === 0) {
      throw new CliError(
        'ENTITY_NOT_FOUND',
        `no ${type} found for slugs: ${slugs.join(', ')}`
      );
    }
    const items = entities.map((entity) =>
      withMeta(ctx.registry.serializeEntity(type, 'element_list_item', entity, ctx.reader))
    );
    writeOutput({ items, missing }, args);
  } finally {
    ctx.close();
  }
}

export const elementListCommand: CliCommandContribution = {
  name: 'element_list',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'ENTITY_NOT_FOUND'],
  handler: runElementList,
};

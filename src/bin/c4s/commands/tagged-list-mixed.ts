import type { ParsedArgs } from '../args.js';
import { optionalString, requireStringList } from '../args.js';
import { createContext } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { withMeta } from './_meta.js';
import type { RawEntityType } from '../../../server/domain/raw-entity-reader.js';

export function runTaggedListMixed(args: ParsedArgs): void {
  const tags = requireStringList(args, 'tags');
  const filterRaw = optionalString(args, 'filter') ?? 'or';
  if (filterRaw !== 'and' && filterRaw !== 'or') {
    throw new CliError('INVALID_ARGS', `--filter must be 'and' or 'or', got '${filterRaw}'`);
  }
  const ctx = createContext(args);
  try {
    const entities = ctx.reader.findByTag({ tags, filter: filterRaw });
    const grouped: Record<string, unknown[]> = {
      endpoints: [],
      dtos: [],
      'database-tables': [],
      'ui-views': [],
      acs: [],
      'design-systems': [],
    };
    const bucket: Record<RawEntityType, keyof typeof grouped> = {
      endpoint: 'endpoints',
      dto: 'dtos',
      'database-table': 'database-tables',
      'ui-view': 'ui-views',
      ac: 'acs',
      'design-system': 'design-systems',
    };
    for (const entity of entities) {
      const result = ctx.registry.serializeEntity(
        entity.type,
        'tagged_list_item',
        entity,
        ctx.reader
      );
      grouped[bucket[entity.type]]!.push(withMeta(result));
    }
    writeOutput({ ...grouped, query: { tags, filter: filterRaw } }, args);
  } finally {
    ctx.close();
  }
}

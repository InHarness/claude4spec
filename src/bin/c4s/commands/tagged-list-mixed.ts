import type { ParsedArgs } from '../args.js';
import { optionalString, requireStringList } from '../args.js';
import { createContext } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { withMeta } from './_meta.js';
import type { RawEntityType } from '../../../server/domain/raw-entity-reader.js';
import type { CliCommandContribution } from '../registry.js';

export async function runTaggedListMixed(args: ParsedArgs): Promise<void> {
  const tags = requireStringList(args, 'tags');
  const filterRaw = optionalString(args, 'filter') ?? 'or';
  if (filterRaw !== 'and' && filterRaw !== 'or') {
    throw new CliError('INVALID_ARGS', `--filter must be 'and' or 'or', got '${filterRaw}'`);
  }
  const ctx = await createContext(args);
  try {
    const entities = ctx.reader.findByTag({ tags, filter: filterRaw });
    const grouped: Record<string, unknown[]> = {
      endpoints: [],
      dtos: [],
      'database-tables': [],
      'ui-views': [],
      acs: [],
      'design-systems': [],
      diagrams: [],
    };
    const bucket: Record<RawEntityType, keyof typeof grouped> = {
      endpoint: 'endpoints',
      dto: 'dtos',
      'database-table': 'database-tables',
      'ui-view': 'ui-views',
      ac: 'acs',
      'design-system': 'design-systems',
      diagram: 'diagrams',
    };
    for (const entity of entities) {
      const result = ctx.registry.serializeEntity(
        entity.type,
        'tagged_list_item',
        entity,
        ctx.reader
      );
      // findByTag only ever returns core RawEntityTypes (out of scope of the
      // M17 generic-capture widening) — safe to narrow back here.
      grouped[bucket[entity.type as RawEntityType]]!.push(withMeta(result));
    }
    writeOutput({ ...grouped, query: { tags, filter: filterRaw } }, args);
  } finally {
    ctx.close();
  }
}

export const taggedListMixedCommand: CliCommandContribution = {
  name: 'tagged_list_mixed',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_ARGS'],
  handler: runTaggedListMixed,
};

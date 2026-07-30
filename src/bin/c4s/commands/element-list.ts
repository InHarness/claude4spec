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
    const result = ctx.discovery.getEntities({ type, slugs, view: 'element_list_item' });
    const found = result.results.filter((r) => r.entity !== null);
    if (found.length === 0) {
      throw new CliError('ENTITY_NOT_FOUND', `no ${type} found for slugs: ${slugs.join(', ')}`);
    }
    writeOutput(
      {
        items: found.map(withMeta),
        missing: result.results.filter((r) => r.entity === null).map((r) => r.slug),
        ...(result.truncated ? { truncated: true, truncationHint: result.truncationHint } : {}),
      },
      args,
    );
  } finally {
    ctx.close();
  }
}

export const elementListCommand: CliCommandContribution = {
  name: 'element_list',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'ENTITY_NOT_FOUND'],
  handler: runElementList,
};

import type { ParsedArgs } from '../args.js';
import { requireString } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { firstEntity } from './_meta.js';
import type { CliCommandContribution } from '../registry.js';

export async function runDetail(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slug = requireString(args, 'slug');
  const ctx = await createContext(args);
  try {
    const result = ctx.discovery.getEntities({ type, slugs: [slug], view: 'detail' });
    writeOutput(firstEntity(result, type, slug), args);
  } finally {
    ctx.close();
  }
}

export const detailCommand: CliCommandContribution = {
  name: 'detail',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'ENTITY_NOT_FOUND'],
  handler: runDetail,
};

import type { ParsedArgs } from '../args.js';
import { requireString } from '../args.js';
import { createContext } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { withMeta } from './_meta.js';
import type { CliCommandContribution } from '../registry.js';

export async function runDetail(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slug = requireString(args, 'slug');
  const ctx = await createContext(args);
  try {
    const entity = ctx.reader.getEntity(type, slug);
    if (!entity) throw new CliError('ENTITY_NOT_FOUND', `${type}/${slug}`);
    const result = ctx.registry.serializeEntity(type, 'detail', entity, ctx.reader);
    writeOutput(withMeta(result), args);
  } finally {
    ctx.close();
  }
}

export const detailCommand: CliCommandContribution = {
  name: 'detail',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'ENTITY_NOT_FOUND'],
  handler: runDetail,
};

import type { ParsedArgs } from '../args.js';
import { requireString } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import type { CliCommandContribution } from '../registry.js';

export async function runListSlugs(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const ctx = await createContext(args);
  try {
    const slugs = ctx.reader.listSlugs(type);
    writeOutput({ type, slugs }, args);
  } finally {
    ctx.close();
  }
}

export const listSlugsCommand: CliCommandContribution = {
  name: 'list-slugs',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE'],
  handler: runListSlugs,
};

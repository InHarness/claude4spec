import type { ParsedArgs } from '../args.js';
import { requireString } from '../args.js';
import { createContext } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { firstEntity } from './_meta.js';
import type { CliCommandContribution } from '../registry.js';

export async function runInlineMention(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slug = requireString(args, 'slug');
  const ctx = await createContext(args);
  try {
    const result = ctx.discovery.getEntities({ type, slugs: [slug], view: 'inline_mention' });
    writeOutput(firstEntity(result, type, slug), args);
  } finally {
    ctx.close();
  }
}

export const inlineMentionCommand: CliCommandContribution = {
  name: 'inline_mention',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'ENTITY_NOT_FOUND'],
  handler: runInlineMention,
};

import type { ParsedArgs } from '../args.js';
import { requireString } from '../args.js';
import { createContext } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { withMeta } from './_meta.js';

export function runInlineMention(args: ParsedArgs): void {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slug = requireString(args, 'slug');
  const ctx = createContext(args);
  try {
    const entity = ctx.reader.getEntity(type, slug);
    if (!entity) throw new CliError('ENTITY_NOT_FOUND', `${type}/${slug}`);
    const result = ctx.registry.serializeEntity(type, 'inline_mention', entity, ctx.reader);
    writeOutput(withMeta(result), args);
  } finally {
    ctx.close();
  }
}

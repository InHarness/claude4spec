import type { ParsedArgs } from '../args.js';
import { requireString } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';

export function runListSlugs(args: ParsedArgs): void {
  const type = normalizeEntityType(requireString(args, 'type'));
  const ctx = createContext(args);
  try {
    const slugs = ctx.reader.listSlugs(type);
    writeOutput({ type, slugs }, args);
  } finally {
    ctx.close();
  }
}

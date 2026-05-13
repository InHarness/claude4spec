import type { ParsedArgs } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';

export function runListTags(args: ParsedArgs): void {
  const ctx = createContext(args);
  try {
    const tags = ctx.reader.listTags();
    writeOutput({ tags }, args);
  } finally {
    ctx.close();
  }
}

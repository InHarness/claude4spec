import type { ParsedArgs } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';

export async function runListTags(args: ParsedArgs): Promise<void> {
  const ctx = await createContext(args);
  try {
    const tags = ctx.reader.listTags();
    writeOutput({ tags }, args);
  } finally {
    ctx.close();
  }
}

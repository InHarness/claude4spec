import type { ParsedArgs } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import type { CliCommandContribution } from '../registry.js';

export async function runListTags(args: ParsedArgs): Promise<void> {
  const ctx = await createContext(args);
  try {
    const tags = ctx.reader.listTags();
    writeOutput({ tags }, args);
  } finally {
    ctx.close();
  }
}

export const listTagsCommand: CliCommandContribution = {
  name: 'list-tags',
  executionMode: 'readonly-reader',
  errorCodes: [],
  handler: runListTags,
};

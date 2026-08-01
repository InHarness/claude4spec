import type { ParsedArgs } from '../args.js';
import { refuseFlags } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * M39: `c4s catalog` is the CLI's name for the core's `overview` operation.
 * The command no longer assembles a catalogue itself — it resolves the project,
 * calls one operation and prints it. The payload gains the project's page roots
 * with their properties and a tag count; it still carries no schemas, so it
 * stays the cheap smoke test it was (`c4s describe` remains the way to schemas).
 */
export async function runCatalog(args: ParsedArgs): Promise<void> {
  refuseFlags(args, ['limit', 'offset'], 'catalog is a projection, bounded by construction');

  const ctx = await createContext(args);
  try {
    writeOutput(await ctx.discovery.overview(), args);
  } finally {
    ctx.close();
  }
}

export const catalogCommand: CliCommandContribution = {
  name: 'catalog',
  executionMode: 'readonly-reader',
  errorCodes: [],
  handler: runCatalog,
};

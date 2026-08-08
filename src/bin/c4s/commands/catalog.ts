import type { ParsedArgs } from '../args.js';
import { refuseFlags } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * M39: `c4s catalog` is the CLI's name for the core's `overview` operation.
 * The command no longer assembles a catalogue itself — it resolves the project,
 * calls one operation and prints it. The payload gains the project's page roots
 * with their properties and a tag count; it still carries no schemas, so it
 * stays the cheap smoke test it was (`c4s describe` remains the way to schemas).
 *
 * 0.2.13 — `server-delegating`, over `GET /api/_meta/overview`. The type set it
 * reports is now the SERVER host's, by construction: there is no second plugin
 * loader left in this process to disagree with it.
 */
export async function runCatalog(args: ParsedArgs): Promise<void> {
  refuseFlags(args, ['limit', 'offset'], 'catalog is a projection, bounded by construction');
  writeOutput(await delegateGet(args, '/_meta/overview'), args);
}

export const catalogCommand: CliCommandContribution = {
  name: 'catalog',
  operation: 'overview',
  executionMode: 'server-delegating',
  errorCodes: [],
  handler: runCatalog,
};

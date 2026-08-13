import { refuseFlags, requireString, type ParsedArgs } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — through the CORE, not the serialization registry.
 *
 * This command called `registry.describe` directly, which made it the one
 * discovery command with its own answer: it returned the schemas but not
 * `searchableFields`, so `c4s describe` could not tell you what a search would
 * cover while the MCP tool of the same name could.
 *
 * 0.2.13 — `server-delegating`, over `GET /api/_meta/types`. `INVALID_TYPE`
 * arrives from the core with the active list attached, and the active list is
 * now unambiguously the server's.
 *
 * 0.2.22 — no `--view`. The answer is the whole type, and it is worth calling
 * before a READ as well as before a write: `selectableFields` says what
 * `get-entities --select` will accept, and `contentFields` says which fields no
 * generic read will carry and which operation hands them over.
 */
export async function runDescribe(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  refuseFlags(args, ['view'], 'the view axis is gone; describe answers the whole type');
  refuseFlags(args, ['limit', 'offset'], 'describe is a projection, bounded by construction');

  writeOutput(await delegateGet(args, '/_meta/types', { type }), args);
}

export const describeCommand: CliCommandContribution = {
  name: 'describe',
  operation: 'describe_types',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS'],
  handler: runDescribe,
};

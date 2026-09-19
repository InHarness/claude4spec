import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 *   c4s list-skills [--context-type chat|brief|patch|ask]
 *
 * 0.2.99 M37 — `server-delegating`, over `GET /api/skills`. The registry and its
 * resolver live in the server process (a project's plugin skills exist nowhere
 * else), so there is no filesystem fallback: with no server this is the
 * health-check's `SERVER_NOT_RUNNING`, never a read of `.claude/skills`.
 *
 * `--context-type` is passed through UNVALIDATED. The enumeration belongs to the
 * context-type registry on the server, and a value outside it comes back as the
 * core's `INVALID_ARGUMENT` listing the legal values — the same code and wording
 * every other channel answers with. A local check would be a second copy of the
 * enum and a second phrasing of the refusal.
 */
export async function runListSkills(args: ParsedArgs): Promise<void> {
  const contextType = optionalString(args, 'context-type');
  const listing = await delegateGet(args, '/skills', contextType === undefined ? {} : { contextType });
  writeOutput(listing, args);
}

export const listSkillsCommand: CliCommandContribution = {
  name: 'list-skills',
  operation: 'list_skills',
  executionMode: 'server-delegating',
  errorCodes: [...SERVER_DELEGATING_CODES, 'INVALID_ARGUMENT'],
  handler: runListSkills,
};

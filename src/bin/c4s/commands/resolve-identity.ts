import type { ParsedArgs } from '../args.js';
import { optionalInt, optionalStringList, refuseFlags, requireString } from '../args.js';
import { delegateGet } from '../delegate.js';
import { refuseSelect } from './_select.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — `resolve_identity` on the CLI: "what is this called?" from a fragment
 * of a name.
 *
 *   c4s resolve-identity --query <q> [--types a,b] [--limit <n>]
 *
 * The ONLY cross-type command, and deliberately a facade over the per-type
 * indexes rather than a cross-type full-text index: matching identity fields
 * over N small lookups federates cleanly, a shared ranking does not.
 *
 * `--limit` but no `--offset` — this is a top-N ranking, and page two of a
 * similarity ranking is the answers the ranking already judged worse.
 *
 * 0.2.13 — `server-delegating`, over `GET /api/_meta/identities`.
 */
export async function runResolveIdentity(args: ParsedArgs): Promise<void> {
  const query = requireString(args, 'query');
  const types = optionalStringList(args, 'types')?.map(normalizeEntityType);
  const limit = optionalInt(args, 'limit');

  refuseSelect(args);
  refuseFlags(args, ['offset'], 'resolve-identity is a top-N ranking: page two is the answers the ranking already judged worse');

  writeOutput(await delegateGet(args, '/_meta/identities', { q: query, types, limit }), args);
}

export const resolveIdentityCommand: CliCommandContribution = {
  name: 'resolve-identity',
  operation: 'resolve_identity',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS'],
  handler: runResolveIdentity,
};

import type { ParsedArgs } from '../args.js';
import { optionalInt, optionalStringList, requireString } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — `resolve_identity` on the CLI: "what is this called?" from a fragment
 * of a name.
 *
 *   c4s resolve-identity --query <q> [--types a,b] [--limit <n>]
 *
 * The ONLY cross-type command, and deliberately a façade over the per-type
 * indexes rather than a cross-type full-text index: matching identity fields
 * over N small lookups federates cleanly, a shared ranking does not.
 *
 * `--limit` but no `--offset` — this is a top-N ranking, and page two of a
 * similarity ranking is the answers the ranking already judged worse.
 */
export async function runResolveIdentity(args: ParsedArgs): Promise<void> {
  const query = requireString(args, 'query');
  const types = optionalStringList(args, 'types')?.map(normalizeEntityType);
  const limit = optionalInt(args, 'limit');

  const ctx = await createContext(args);
  try {
    writeOutput(
      ctx.discovery.resolveIdentity({
        query,
        ...(types ? { types } : {}),
        ...(limit === undefined ? {} : { limit }),
      }),
      args,
    );
  } finally {
    ctx.close();
  }
}

export const resolveIdentityCommand: CliCommandContribution = {
  name: 'resolve-identity',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'INVALID_ARGUMENT'],
  handler: runResolveIdentity,
};

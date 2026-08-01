import type { ParsedArgs } from '../args.js';
import { optionalString, optionalStringList, paginationFrom, requireString } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType, normalizeViewKind } from '../type-validation.js';
import { CliError } from '../errors.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — complete, paginated traversal of ONE entity type.
 *
 *   c4s list-entities --type <t> [--tags a,b] [--filter and|or] [--view <v>]
 *                     [--mode items|count] [--limit <n>] [--offset <n>]
 *
 * This is the command that makes search best-effort rather than load-bearing:
 * an entity nobody tagged is still reachable by enumeration. `--mode count`
 * answers "how many" without paying for the listing — measurement before
 * fetching is the contract, not a nicety.
 *
 * `c4s list-slugs` remains as the shorthand for the minimal view.
 */
export async function runListEntities(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const tags = optionalStringList(args, 'tags');
  const rawView = optionalString(args, 'view');
  const view = rawView === undefined ? undefined : normalizeViewKind(rawView);

  const rawFilter = optionalString(args, 'filter');
  if (rawFilter !== undefined && rawFilter !== 'and' && rawFilter !== 'or') {
    throw new CliError('INVALID_ARGS', `--filter must be 'and' or 'or', got '${rawFilter}'`);
  }
  const rawMode = optionalString(args, 'mode');
  if (rawMode !== undefined && rawMode !== 'items' && rawMode !== 'count') {
    throw new CliError('INVALID_ARGS', `--mode must be 'items' or 'count', got '${rawMode}'`);
  }

  const ctx = await createContext(args);
  try {
    writeOutput(
      ctx.discovery.listEntities({
        type,
        ...(tags ? { tags } : {}),
        ...(rawFilter ? { filter: rawFilter } : {}),
        ...(view ? { view } : {}),
        ...(rawMode ? { mode: rawMode } : {}),
        ...paginationFrom(args),
      }),
      args,
    );
  } finally {
    ctx.close();
  }
}

export const listEntitiesCommand: CliCommandContribution = {
  name: 'list-entities',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'INVALID_VIEW', 'INVALID_ARGS', 'INVALID_ARGUMENT'],
  handler: runListEntities,
};

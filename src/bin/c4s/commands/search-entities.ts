import type { ParsedArgs } from '../args.js';
import { optionalString, optionalStringList, paginationFrom, requireString } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType, normalizeViewKind } from '../type-validation.js';
import { CliError } from '../errors.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — `search_entities` on the CLI.
 *
 *   c4s search-entities --type <t> --query <q> [--fields a,b] [--view <v>]
 *                       [--mode hits|count] [--limit <n>] [--offset <n>]
 *
 * `--type` is REQUIRED: a cross-type full-text index federates rankings badly
 * and lets one call return hundreds of rows. `c4s resolve-identity` is the
 * compensation, and the only cross-type command.
 *
 * The output always declares `searchedFields`, so an empty result is
 * distinguishable from a field that was never searched.
 */
export async function runSearchEntities(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const query = requireString(args, 'query');
  const fields = optionalStringList(args, 'fields');
  const rawView = optionalString(args, 'view');
  const view = rawView === undefined ? undefined : normalizeViewKind(rawView);

  const rawMode = optionalString(args, 'mode');
  if (rawMode !== undefined && rawMode !== 'hits' && rawMode !== 'count') {
    throw new CliError('INVALID_ARGS', `--mode must be 'hits' or 'count', got '${rawMode}'`);
  }

  const ctx = await createContext(args);
  try {
    writeOutput(
      ctx.discovery.searchEntities({
        type,
        query,
        ...(fields ? { fields } : {}),
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

export const searchEntitiesCommand: CliCommandContribution = {
  name: 'search-entities',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'INVALID_VIEW', 'INVALID_ARGS', 'INVALID_ARGUMENT'],
  handler: runSearchEntities,
};

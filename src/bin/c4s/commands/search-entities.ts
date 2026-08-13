import type { ParsedArgs } from '../args.js';
import { refuseFlags, optionalString, optionalStringList, paginationFrom, requireString } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { refuseSelect } from './_select.js';
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
 *
 * 0.2.13 — `server-delegating`, over `GET /api/entities/:type/search`.
 */
export async function runSearchEntities(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const query = requireString(args, 'query');
  const fields = optionalStringList(args, 'fields');
  refuseSelect(args);
  refuseFlags(args, ['view'], 'the view axis is gone; search hits are a fixed { slug, title, score } row');

  const rawMode = optionalString(args, 'mode');
  if (rawMode !== undefined && rawMode !== 'hits' && rawMode !== 'count') {
    throw new CliError('INVALID_ARGS', `--mode must be 'hits' or 'count', got '${rawMode}'`);
  }

  writeOutput(
    await delegateGet(args, `/entities/${type}/search`, {
      q: query,
      fields,
      mode: rawMode,
      ...paginationFrom(args),
    }),
    args,
  );
}

export const searchEntitiesCommand: CliCommandContribution = {
  name: 'search-entities',
  operation: 'search_entities',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'INVALID_ARGUMENT'],
  handler: runSearchEntities,
};

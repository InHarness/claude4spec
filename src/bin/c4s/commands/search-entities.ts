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
 *   c4s search-entities --type <t> (--query <q> | --regex <r>) [--fields a,b]
 *                       [--mode count|map|hits] [--limit <n>] [--offset <n>]
 *
 * `--type` is REQUIRED: a cross-type full-text index federates rankings badly
 * and lets one call return hundreds of rows. `c4s resolve-identity` is the
 * compensation, and the only cross-type command.
 *
 * The output always declares `searchedFields`, so an empty result is
 * distinguishable from a field that was never searched.
 *
 * 0.2.13 — `server-delegating`, over `GET /api/entities/:type/search`.
 *
 * 0.2.95 — parity with `c4s search-pages`: a second input (`--regex`), the
 * three-rung ladder with `--mode map` as the default, and `matchCount` in place
 * of `score` on the row. TWO DELIBERATE GAPS against the page command, both
 * about the same thing — a fragment here is EVIDENCE, not a projection:
 *
 *   - no `--context`, because the hunk window is character-based and fixed (a
 *     field value has no lines to count);
 *   - no `--select`, even though `--mode hits` carries fragments. The hunk's
 *     `field` is a legal `select` value for `c4s get-entities`, which is the
 *     command that answers with a projection.
 */
export async function runSearchEntities(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const query = optionalString(args, 'query');
  const regex = optionalString(args, 'regex');
  /*
   * The same two refusals `search-pages` raises, in the same two codes: both
   * given is an `INVALID_ARGUMENT` with the repair, neither given is the
   * "you typed the flags wrong" code. The core refuses identically for every
   * other channel; this copy exists so the CLI can answer without a round trip.
   */
  if (query && regex) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '--query and --regex are alternatives, not a refinement of one another',
      'pass one of them: --query "<phrase>" for a text search, --regex "<pattern>" for a pattern',
    );
  }
  if (!query && !regex) {
    throw new CliError('INVALID_ARGS', 'search-entities requires --query or --regex');
  }
  const fields = optionalStringList(args, 'fields');
  refuseSelect(args);
  refuseFlags(
    args,
    ['view'],
    'the view axis is gone; search hits are a fixed { slug, title, matchCount } row',
  );
  refuseFlags(
    args,
    ['context'],
    'there is no --context on the entity side: the hunk window is measured in characters and is fixed. ' +
      'Use --mode hits for fragments, then c4s get-entities --select <field> for the full value',
  );

  const rawMode = optionalString(args, 'mode');
  if (rawMode !== undefined && rawMode !== 'hits' && rawMode !== 'map' && rawMode !== 'count') {
    throw new CliError(
      'INVALID_ARGS',
      `--mode must be 'count', 'map' or 'hits', got '${rawMode}'`,
      "the ladder is cost-ordered: 'count' for the totals, 'map' (the default) for " +
        "{ slug, title, matchCount }, 'hits' to add the fragments",
    );
  }

  writeOutput(
    await delegateGet(args, `/entities/${type}/search`, {
      q: query,
      regex,
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
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'INVALID_ARGUMENT', 'SEARCH_BUDGET_EXCEEDED'],
  handler: runSearchEntities,
};

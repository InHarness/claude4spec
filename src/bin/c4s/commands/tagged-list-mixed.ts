import type { ParsedArgs } from '../args.js';
import { optionalString, requireStringList } from '../args.js';
import { delegateGet, delegateGetAll } from '../delegate.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { pickEntityPage, withMeta } from './_meta.js';
import type { OverviewResult } from '../../../server/discovery/index.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * The mixed tag traversal is a COMPOSITION on the transport side, not a core
 * operation: the core answers per type (`list_entities`), and grouping those
 * answers under plural keys is presentation.
 *
 * 0.2.13 — `server-delegating`. The type set comes from `overview`, so the
 * buckets are the SERVER host's types by construction. That closes the last way
 * this command could lie: it used to read a loader of its own, so a project
 * whose server had a plugin the `c4s` package did not — or a different version
 * of one — got buckets that did not match the specification it was describing.
 *
 * Seeded from AVAILABLE types, not active ones, so a deactivated type still
 * reports `[]` rather than vanishing: `jq '.endpoints | length'` breaks on a
 * missing key, and a script cannot tell "this type has nothing" from "this key
 * was never emitted".
 */
export async function runTaggedListMixed(args: ParsedArgs): Promise<void> {
  const tags = requireStringList(args, 'tags');
  const filterRaw = optionalString(args, 'filter') ?? 'or';
  if (filterRaw !== 'and' && filterRaw !== 'or') {
    throw new CliError('INVALID_ARGS', `--filter must be 'and' or 'or', got '${filterRaw}'`);
  }

  const overview = (await delegateGet(args, '/_meta/overview')) as OverviewResult & {
    availableTypes?: string[];
  };
  const activeTypes = Object.keys(overview.types ?? {});
  // `overview` reports the ACTIVE types keyed by name. The available set is the
  // wider one the empty buckets come from; when the payload does not carry it,
  // the active set is the honest fallback — a bucket that is absent is better
  // than one invented from a list this process no longer has.
  const seedTypes = overview.availableTypes ?? activeTypes;

  const grouped: Record<string, unknown[]> = Object.fromEntries(
    seedTypes.map((t) => [`${t}s`, [] as unknown[]]),
  );
  for (const type of activeTypes) {
    const { items } = await delegateGetAll(
      args,
      `/entities/${type}/list`,
      { tags, filter: filterRaw, view: 'tagged_list_item' },
      pickEntityPage,
    );
    grouped[`${type}s`] = items.map(withMeta);
  }
  writeOutput({ ...grouped, query: { tags, filter: filterRaw } }, args);
}

export const taggedListMixedCommand: CliCommandContribution = {
  name: 'tagged_list_mixed',
  operation: 'list_entities',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_ARGS'],
  handler: runTaggedListMixed,
};

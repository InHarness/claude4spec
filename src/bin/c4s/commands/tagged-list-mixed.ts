import type { ParsedArgs } from '../args.js';
import { optionalString, requireStringList } from '../args.js';
import { createContext } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { withMeta } from './_meta.js';
import { listEntitiesAll } from '../../../server/discovery/index.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * The mixed tag traversal is a COMPOSITION on the transport side, not a core
 * operation: the core answers per type (`list_entities`), and grouping those
 * answers under plural keys is presentation.
 *
 * M39 also drops the hardcoded seven-bucket map this command carried. All seven
 * core buckets were the type name plus an `s`, and the literal map meant a
 * plugin-contributed type indexed into `undefined` and crashed the command. The
 * output for the core types is unchanged; a plugin type now gets its own bucket
 * instead of taking the command down.
 */
export async function runTaggedListMixed(args: ParsedArgs): Promise<void> {
  const tags = requireStringList(args, 'tags');
  const filterRaw = optionalString(args, 'filter') ?? 'or';
  if (filterRaw !== 'and' && filterRaw !== 'or') {
    throw new CliError('INVALID_ARGS', `--filter must be 'and' or 'or', got '${filterRaw}'`);
  }
  const ctx = await createContext(args);
  try {
    // 0.2.11: the seed is registry-driven, not a frozen seven. It used to assert
    // a bucket for `database-tables` whether or not that plugin was installed,
    // while a plugin type the project DID have got no such courtesy.
    //
    // It is seeded from AVAILABLE types, not active ones, so the contract the old
    // comment promised survives: "a shell pipeline reading `.endpoints` must keep
    // getting `[]` for a deactivated type rather than `null`". `jq '.endpoints |
    // length'` breaks on a missing key, and a script cannot tell "this type has
    // nothing" from "this key was never emitted".
    const grouped: Record<string, unknown[]> = Object.fromEntries(
      ctx.reader.host.listAvailable().map((m) => [`${m.type}s`, [] as unknown[]]),
    );
    for (const type of ctx.reader.listTypes()) {
      grouped[`${type}s`] = listEntitiesAll(ctx.discovery, {
        type,
        tags,
        filter: filterRaw,
        view: 'tagged_list_item',
      }).map(withMeta);
    }
    writeOutput({ ...grouped, query: { tags, filter: filterRaw } }, args);
  } finally {
    ctx.close();
  }
}

export const taggedListMixedCommand: CliCommandContribution = {
  name: 'tagged_list_mixed',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_ARGS'],
  handler: runTaggedListMixed,
};

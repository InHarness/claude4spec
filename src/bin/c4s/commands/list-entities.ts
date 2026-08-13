import type { ParsedArgs } from '../args.js';
import { optionalString, optionalStringList, paginationFrom, refuseFlags, requireString } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { refuseSelect } from './_select.js';
import { CliError } from '../errors.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — complete, paginated traversal of ONE entity type.
 *
 *   c4s list-entities --type <t> [--tags a,b] [--tag-filter and|or]
 *                     [--sort createdAt|title|slug] [--dir asc|desc]
 *                     [--mode items|count] [--limit <n>] [--offset <n>]
 *
 * This is the command that makes search best-effort rather than load-bearing:
 * an entity nobody tagged is still reachable by enumeration. `--mode count`
 * answers "how many" without paying for the listing — measurement before
 * fetching is the contract, not a nicety.
 *
 * 0.2.22 — `c4s list-slugs` is GONE, absorbed here. It existed because the row
 * used to be a bare slug and getting names meant a second call per entity; the
 * row carries `title` now, so the N+1 it worked around does not exist. No alias:
 * a command that silently answers a different shape is worse than one that is
 * not there.
 *
 * Also this release: `--filter` is `--tag-filter` (one spelling on every
 * surface), and `--sort`/`--dir` arrive. There is no `--view` and no `--select`
 * — the row is frozen at `{slug, title}`, and asking this command for width is
 * INVALID_ARGUMENT pointing at `get-entities`.
 *
 * 0.2.13 — `server-delegating`, over `GET /api/entities/:type/list`. Flag
 * validation stays here because "you typed the flags wrong" is the CLI's own
 * refusal, thrown before the server is addressed at all.
 */
export async function runListEntities(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const tags = optionalStringList(args, 'tags');
  refuseSelect(args);
  refuseFlags(args, ['view'], 'the view axis is gone; this command has a fixed row');

  const rawTagFilter = optionalString(args, 'tag-filter');
  if (rawTagFilter !== undefined && rawTagFilter !== 'and' && rawTagFilter !== 'or') {
    throw new CliError('INVALID_ARGS', `--tag-filter must be 'and' or 'or', got '${rawTagFilter}'`);
  }
  const rawSort = optionalString(args, 'sort');
  if (rawSort !== undefined && !['createdAt', 'title', 'slug'].includes(rawSort)) {
    throw new CliError('INVALID_ARGS', `--sort must be 'createdAt', 'title' or 'slug', got '${rawSort}'`);
  }
  const rawDir = optionalString(args, 'dir');
  if (rawDir !== undefined && rawDir !== 'asc' && rawDir !== 'desc') {
    throw new CliError('INVALID_ARGS', `--dir must be 'asc' or 'desc', got '${rawDir}'`);
  }
  const rawMode = optionalString(args, 'mode');
  if (rawMode !== undefined && rawMode !== 'items' && rawMode !== 'count') {
    throw new CliError('INVALID_ARGS', `--mode must be 'items' or 'count', got '${rawMode}'`);
  }

  writeOutput(
    await delegateGet(args, `/entities/${type}/list`, {
      tags,
      tagFilter: rawTagFilter,
      sort: rawSort,
      dir: rawDir,
      mode: rawMode,
      ...paginationFrom(args),
    }),
    args,
  );
}

export const listEntitiesCommand: CliCommandContribution = {
  name: 'list-entities',
  operation: 'list_entities',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'INVALID_ARGUMENT'],
  handler: runListEntities,
};

import type { ParsedArgs } from '../args.js';
import { requireString } from '../args.js';
import { delegateGetAll } from '../delegate.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { pickEntityPage } from './_meta.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * The shorthand: every slug of one type, nothing else.
 *
 * 0.2.13 — `server-delegating`, over `GET /api/entities/:type/list`, swept to
 * the end and projected down to the slugs. In-process this read
 * `RawEntityReader.listSlugs` directly, which is why it needed a local
 * `INVALID_TYPE` guard of its own: the reader answers `[]` for a type it has
 * never heard of, so a typo (`--type dtos`) exited 0 reporting "no entities of
 * this type" — the confidently-empty answer that authorizes a rename or a
 * delete. The route refuses an inactive type with `INVALID_TYPE` and the active
 * list, so the guard is no longer this command's to carry.
 *
 * The cheapest view is asked for deliberately: only `slug` is read, and
 * `inline_mention` is the smallest payload the core will serialize.
 */
export async function runListSlugs(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const { items, exhausted } = await delegateGetAll(
    args,
    `/entities/${type}/list`,
    { view: 'inline_mention' },
    pickEntityPage,
  );
  // Reported for the same reason as `tagged_list`: a slug list cut short by the
  // runaway guard and presented as complete is what authorizes a rename or a
  // delete against a set that was never fully seen.
  writeOutput({ type, slugs: items.map((i) => i.slug), hasMore: !exhausted }, args);
}

export const listSlugsCommand: CliCommandContribution = {
  name: 'list-slugs',
  operation: 'list_entities',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS'],
  handler: runListSlugs,
};

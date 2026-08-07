import type { ParsedArgs } from '../args.js';
import { optionalString, refuseFlags, requireString, requireStringList } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType, normalizeViewKind } from '../type-validation.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — the CANONICAL entity-fetch surface on the CLI.
 *
 *   c4s get-entities --type <t> --slugs <a,b,c> [--view <v>]
 *
 * The six XML-tag commands (`inline_mention`, `single_element`, `element_list`,
 * `tagged_list`, `tagged_list_mixed`, `detail`) are ALIASES of this and of
 * `list-entities` with a fixed `--view`. They stay because a page author reading
 * a tag wants the command that spells the tag; parity with the core is
 * operational, not nominal.
 *
 * No `--limit`/`--offset`: the caller names the rows, so the valve is the input
 * length cap plus the response budget, not a page.
 *
 * 0.2.13 — `server-delegating`. The payload is the operation's own envelope,
 * printed as it arrived: the entities were serialized by the server, which is
 * the only process that still knows how.
 */
export async function runGetEntities(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slugs = requireStringList(args, 'slugs');
  const rawView = optionalString(args, 'view');
  const view = rawView === undefined ? undefined : normalizeViewKind(rawView);

  refuseFlags(args, ['limit', 'offset'], 'get-entities is fetch-by-key: you name the rows, so the valve is the slug-list cap plus the response budget');

  writeOutput(await delegateGet(args, `/entities/${type}/get`, { slugs, view }), args);
}

export const getEntitiesCommand: CliCommandContribution = {
  name: 'get-entities',
  operation: 'get_entities',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_VIEW', 'INVALID_ARGS', 'INVALID_ARGUMENT'],
  handler: runGetEntities,
};

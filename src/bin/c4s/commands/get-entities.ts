import type { ParsedArgs } from '../args.js';
import { optionalString, refuseFlags, requireString, requireStringList } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — the CANONICAL entity-fetch surface on the CLI.
 *
 *   c4s get-entities --type <t> --slugs <a,b,c> [--select <f1,f2>]
 *
 * The six XML-tag commands (`inline_mention`, `single_element`, `element_list`,
 * `tagged_list`, `tagged_list_mixed`, `detail`) are ALIASES of this and of
 * `list-entities`, each with a projection fixed by the tag it spells. They stay
 * because a page author reading a tag wants the command that spells the tag;
 * parity with the core is operational, not nominal. They are also why the view
 * vocabulary survives INTERNALLY — those commands still pick a shape, they just
 * no longer let anyone name it.
 *
 * 0.2.22 — `--view` became `--select`, and the difference is who decides the
 * shape. A view was one of five the TYPE declared; a projection is a list of
 * FIELDS the caller names, which the host resolves against the schema.
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
  refuseFlags(args, ['view'], 'the view axis is gone — name the fields you want with --select');
  refuseFlags(args, ['limit', 'offset'], 'get-entities is fetch-by-key: you name the rows, so the valve is the slug-list cap plus the response budget');

  /**
   * `--select` with an empty value is the identity skeleton, not "no
   * projection". `--select=` and omitting the flag are different requests, so
   * the empty string cannot collapse into `undefined` here.
   */
  const rawSelect = optionalString(args, 'select');
  const select = rawSelect === undefined ? undefined : rawSelect.split(',').map((s) => s.trim()).filter(Boolean);

  writeOutput(
    await delegateGet(args, `/entities/${type}/get`, {
      slugs,
      ...(select ? { select: select.join(',') } : {}),
    }),
    args,
  );
}

export const getEntitiesCommand: CliCommandContribution = {
  name: 'get-entities',
  operation: 'get_entities',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'INVALID_ARGUMENT'],
  handler: runGetEntities,
};

import type { ParsedArgs } from '../args.js';
import { requireString, requireStringList } from '../args.js';
import { delegateGet } from '../delegate.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { withMeta } from './_meta.js';
import type { GetEntitiesResult } from '../../../server/discovery/index.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.13 — `server-delegating`, over `GET /api/entities/:type/get`.
 *
 * The batch is answered in ONE call: `get_entities` is fetch-by-key, so it takes
 * no window and the server's response budget is the only valve. The command
 * keeps its own shape — found items under `items`, the rest named under
 * `missing` — because a page author reading `<element_list/>` wants to know
 * which slugs the tag will not render.
 */
export async function runElementList(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slugs = requireStringList(args, 'slugs');
  const result = (await delegateGet(args, `/entities/${type}/get`, {
    slugs,
    view: 'element_list_item',
  })) as GetEntitiesResult;
  const found = result.results.filter((r) => r.entity !== null);
  if (found.length === 0) {
    throw new CliError('ENTITY_NOT_FOUND', `no ${type} found for slugs: ${slugs.join(', ')}`);
  }
  writeOutput(
    {
      items: found.map(withMeta),
      missing: result.results.filter((r) => r.entity === null).map((r) => r.slug),
    },
    args,
  );
}

export const elementListCommand: CliCommandContribution = {
  name: 'element_list',
  operation: 'get_entities',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'ENTITY_NOT_FOUND'],
  handler: runElementList,
};

import type { ParsedArgs } from '../args.js';
import { requireString, requireStringList } from '../args.js';
import { delegateGetEntities } from '../delegate.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { unwrapEntity } from './_meta.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.13 — `server-delegating`, over `GET /api/entities/:type/get`.
 *
 * Through `delegateGetEntities` rather than one raw call, because this is the
 * TAG RENDERER and it promised two things the raw operation deliberately does
 * not: that a list of more than fifty slugs is batched rather than refused, and
 * that a row the response budget degraded is re-fetched rather than reported as
 * a slug that does not exist. See that function for why each matters; both were
 * provided by the deleted `getEntitiesAll` and had to survive the move.
 *
 * The command keeps its own shape — found items under `items`, the rest named
 * under `missing` — because a page author reading `<element_list/>` wants to
 * know which slugs the tag will not render.
 */
export async function runElementList(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slugs = requireStringList(args, 'slugs');
  // `select: []` — a list row is a link and a label, which is the identity
  // skeleton. `element_list_item` was a view name the route stopped reading.
  const rows = await delegateGetEntities(args, type, slugs, []);
  const found = rows.filter((r) => r.entity !== null);
  if (found.length === 0) {
    throw new CliError('ENTITY_NOT_FOUND', `no ${type} found for slugs: ${slugs.join(', ')}`);
  }
  writeOutput(
    {
      items: found.map(unwrapEntity),
      missing: rows.filter((r) => r.entity === null).map((r) => r.slug),
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

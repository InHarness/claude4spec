import type { ParsedArgs } from '../args.js';
import { requireString } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { firstEntity } from './_meta.js';
import type { GetEntitiesResult } from '../../../server/discovery/index.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.13 — `server-delegating`. One slug is the degenerate case of a slug LIST
 * in the core, so this wraps `GET /api/entities/:type/get` and unwraps the
 * single row; `firstEntity` turns an absent one back into the CLI's
 * `ENTITY_NOT_FOUND`, which the list-shaped operation reports as a null row
 * rather than as an error.
 *
 * 0.2.22 — the default projection, which is the widest a generic read gives.
 * `--select` on `get-entities` is how a caller asks for anything narrower; see
 * `single_element` for why the two names now make the same call.
 */
export async function runDetail(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slug = requireString(args, 'slug');
  const result = (await delegateGet(args, `/entities/${type}/get`, {
    slugs: [slug],
  })) as GetEntitiesResult;
  writeOutput(firstEntity(result, type, slug), args);
}

export const detailCommand: CliCommandContribution = {
  name: 'detail',
  operation: 'get_entities',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'ENTITY_NOT_FOUND'],
  handler: runDetail,
};

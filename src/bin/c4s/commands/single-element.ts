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
 * 0.2.22 — no projection at all, because the whole record IS what this tag
 * renders. That makes it the same call as `detail`, and saying so is more
 * honest than keeping a distinction the read contract no longer has: the two
 * differed only by a `view` the route stopped reading. `detail` survives as the
 * name without an XML counterpart, this one as the name with one.
 */
export async function runSingleElement(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slug = requireString(args, 'slug');
  const result = (await delegateGet(args, `/entities/${type}/get`, {
    slugs: [slug],
  })) as GetEntitiesResult;
  writeOutput(firstEntity(result, type, slug), args);
}

export const singleElementCommand: CliCommandContribution = {
  name: 'single_element',
  operation: 'get_entities',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'ENTITY_NOT_FOUND'],
  handler: runSingleElement,
};

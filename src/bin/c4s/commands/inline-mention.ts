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
 * in the core, so this wraps `GET /api/entities/:type/get` with a fixed
 * PROJECTION and unwraps the single row; `firstEntity` turns an absent one back
 * into the CLI's `ENTITY_NOT_FOUND`, which the list-shaped operation reports as
 * a null row rather than as an error.
 *
 * 0.2.22 — `select: []`, where `view: 'inline_mention'` used to be. A chip is a
 * label and a link, which is exactly the identity skeleton the empty projection
 * returns. Keeping the retired parameter would have been worse than renaming it
 * late: the route stopped reading `view` and answered the full record, so a
 * command whose whole promise is "narrow" quietly became the widest one.
 */
export async function runInlineMention(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slug = requireString(args, 'slug');
  const result = (await delegateGet(args, `/entities/${type}/get`, {
    slugs: [slug],
    select: [],
  })) as GetEntitiesResult;
  writeOutput(firstEntity(result, type, slug), args);
}

export const inlineMentionCommand: CliCommandContribution = {
  name: 'inline_mention',
  operation: 'get_entities',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'ENTITY_NOT_FOUND'],
  handler: runInlineMention,
};

import type { ParsedArgs } from '../args.js';
import { optionalString, requireString, requireStringList } from '../args.js';
import { createContext } from '../context.js';
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
 */
export async function runGetEntities(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slugs = requireStringList(args, 'slugs');
  const rawView = optionalString(args, 'view');
  const view = rawView === undefined ? undefined : normalizeViewKind(rawView);

  const ctx = await createContext(args);
  try {
    writeOutput(ctx.discovery.getEntities({ type, slugs, ...(view ? { view } : {}) }), args);
  } finally {
    ctx.close();
  }
}

export const getEntitiesCommand: CliCommandContribution = {
  name: 'get-entities',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'INVALID_VIEW', 'INVALID_ARGS', 'INVALID_ARGUMENT'],
  handler: runGetEntities,
};

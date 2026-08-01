import { optionalString, requireString, type ParsedArgs } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType, normalizeViewKind } from '../type-validation.js';
import type { CliCommandContribution } from '../registry.js';

export async function runDescribe(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const viewFlag = optionalString(args, 'view');
  const view = viewFlag ? normalizeViewKind(viewFlag) : undefined;
  const ctx = await createContext(args);
  try {
    /**
     * 0.2.6 — through the CORE, not the serialization registry.
     *
     * This command called `registry.describe` directly, which made it the one
     * discovery command with its own answer: it returned the schemas but not
     * `searchableFields`, so `c4s describe` could not tell you what a search
     * would cover while the MCP tool of the same name could. The skill has
     * documented the core's answer ("plus the paths a search would cover") for
     * two releases. `INVALID_TYPE` now arrives from the core with the active
     * list attached, which is strictly more than the local throw carried.
     */
    writeOutput(ctx.discovery.describeTypes({ types: [type], ...(view ? { view } : {}) }), args);
  } finally {
    ctx.close();
  }
}

export const describeCommand: CliCommandContribution = {
  name: 'describe',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'INVALID_VIEW'],
  handler: runDescribe,
};

import { optionalString, requireString, type ParsedArgs } from '../args.js';
import { createContext } from '../context.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType, normalizeViewKind } from '../type-validation.js';
import type { CliCommandContribution } from '../registry.js';

export async function runDescribe(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const viewFlag = optionalString(args, 'view');
  const view = viewFlag ? normalizeViewKind(viewFlag) : undefined;
  const ctx = await createContext(args);
  try {
    const result = ctx.registry.describe(type, view, ctx.db);
    if (!result) {
      throw new CliError(
        'INVALID_TYPE',
        `entity type '${type}' is not active`,
        'run `c4s catalog` for the list of active types'
      );
    }
    writeOutput(result, args);
  } finally {
    ctx.close();
  }
}

export const describeCommand: CliCommandContribution = {
  name: 'describe',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'INVALID_VIEW'],
  handler: runDescribe,
};

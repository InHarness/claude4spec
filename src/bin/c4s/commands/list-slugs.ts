import type { ParsedArgs } from '../args.js';
import { requireString } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import { CliError } from '../errors.js';
import type { CliCommandContribution } from '../registry.js';

export async function runListSlugs(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const ctx = await createContext(args);
  try {
    // 0.2.11: `normalizeEntityType` now only checks the SHAPE of `--type` — it
    // runs before a project is open, so it cannot know which types exist. Every
    // other command routes through a discovery op that re-establishes existence
    // and throws `invalidType`; this one goes straight to the reader, which
    // answers `[]` for a type it has never heard of. Without this check a typo
    // (`--type dtos`) exits 0 reporting "no entities of this type" — the kind of
    // confidently-empty answer that authorizes a rename or a delete.
    const activeTypes = ctx.reader.listTypes();
    if (!activeTypes.includes(type)) {
      throw new CliError(
        'INVALID_TYPE',
        `entity type '${type}' is unknown or not active in this project`,
        `active types: ${activeTypes.join(', ')} — run \`c4s catalog\` for detail`,
      );
    }
    const slugs = ctx.reader.listSlugs(type);
    writeOutput({ type, slugs }, args);
  } finally {
    ctx.close();
  }
}

export const listSlugsCommand: CliCommandContribution = {
  name: 'list-slugs',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS'],
  handler: runListSlugs,
};

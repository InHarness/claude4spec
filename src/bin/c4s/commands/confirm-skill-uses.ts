import type { ParsedArgs } from '../args.js';
import { optionalInt, optionalString } from '../args.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { confirmSkillUsesForDirectory } from '../../../server/workspace/trust-plugins.js';
import { registryWriteCliError } from './_registry-write.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 2.1.67 (M31 `m31cli01`, record `confirm-skill-uses`, mode `registry-write`):
 * the machine-local confirmation of the project's skill attachments, written
 * into the global registry server-free.
 *
 *   c4s confirm-skill-uses --cwd <dir> spec-style shared-glossary
 *   c4s confirm-skill-uses --cwd <dir> --clear
 *
 * The project is resolved from `--cwd` exactly as `trust-plugins` does (steps
 * 1–3 of its `logic`, `--port` for a registry workspace), then
 * `setSkillUsesConfirmation` stores the list — what a confirmation MEANS is
 * M52's. The names replace the stored list whole; `--clear` stores it empty.
 * All of it lives in the M31 core (`confirmSkillUsesForDirectory`).
 */
export async function runConfirmSkillUses(args: ParsedArgs): Promise<void> {
  const cwd = optionalString(args, 'cwd');
  if (!cwd) throw new CliError('INVALID_ARGS', '--cwd is required');
  const clear = args.flags.get('clear') === true;
  const names = args.positional;
  if (clear && names.length > 0) {
    throw new CliError('INVALID_ARGS', '--clear removes every confirmation — pass either names or --clear, not both');
  }
  if (!clear && names.length === 0) {
    throw new CliError('INVALID_ARGS', 'pass the names to confirm, or --clear to remove every confirmation');
  }
  const port = optionalInt(args, 'port');

  let result;
  try {
    result = confirmSkillUsesForDirectory({ cwd, names: clear ? [] : names, ...(port !== undefined ? { port } : {}) });
  } catch (err) {
    throw registryWriteCliError(err) ?? err;
  }
  writeOutput(result, args);
}

export const confirmSkillUsesCommand: CliCommandContribution = {
  name: 'confirm-skill-uses',
  executionMode: 'registry-write',
  flags: ['cwd', 'port', 'clear'],
  errorCodes: ['INVALID_ARGS', 'REGISTRY_MIGRATION_PENDING', 'PROJECT_NOT_IN_WORKSPACE_FILE', 'WORKSPACE_FILE_INVALID'],
  output: { unit: 'one project', fields: ['workspace', 'projectId', 'cwd', 'confirmedSkillUses', 'notInSkillUses'] },
  handler: runConfirmSkillUses,
};

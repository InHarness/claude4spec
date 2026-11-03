import type { ParsedArgs } from '../args.js';
import { optionalInt, optionalString } from '../args.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { registerHomeDirectory } from '../../../server/workspace/register-home.js';
import { registryWriteCliError } from './_registry-write.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 2.1.67 (M31 `m31cli01`, record `register-home`, mode `registry-write`):
 * register an EXISTING workspace home in the global registry (`$C4S_HOME`
 * honoured), server-free — the first step of building the registry in an empty
 * `HOME` (`register-home` → `trust-plugins` → `confirm-skill-uses`).
 *
 *   c4s register-home --cwd /workspace/home
 *   c4s register-home --cwd <dir> --port 4600 [--workspace <name>]
 *
 * `--workspace` names the NEW entry here (it is not the shared selector: the
 * command resolves no project). Nothing is written into `<dir>` — the committed
 * `workspace.json` must already be there. Every rule lives in the M31 core
 * (`registerHomeDirectory` → `WorkspaceRegistry.registerHome`); this file only
 * parses argv and maps the refusals.
 */
export async function runRegisterHome(args: ParsedArgs): Promise<void> {
  const cwd = optionalString(args, 'cwd');
  if (!cwd) throw new CliError('INVALID_ARGS', '--cwd is required');
  if (args.positional.length > 0) {
    throw new CliError('INVALID_ARGS', `register-home takes no positional arguments, got '${args.positional.join(' ')}'`);
  }
  const port = optionalInt(args, 'port');
  const name = args.workspace;

  let result;
  try {
    result = registerHomeDirectory({
      cwd,
      ...(name !== undefined ? { name } : {}),
      ...(port !== undefined ? { port } : {}),
    });
  } catch (err) {
    throw registryWriteCliError(err) ?? err;
  }
  writeOutput(result, args);
}

export const registerHomeCommand: CliCommandContribution = {
  name: 'register-home',
  executionMode: 'registry-write',
  flags: ['cwd', 'workspace', 'port'],
  errorCodes: [
    'INVALID_ARGS',
    'REGISTRY_MIGRATION_PENDING',
    'WORKSPACE_FILE_MISSING',
    'WORKSPACE_FILE_INVALID',
    'CWD_IS_PROJECT',
    'CWD_INSIDE_HOME',
    'WORKSPACE_HOME_MISMATCH',
    'PORT_TAKEN_BY_WORKSPACE',
  ],
  output: { unit: 'one workspace entry', fields: ['workspace', 'home', 'defaultPort', 'created'] },
  handler: runRegisterHome,
};

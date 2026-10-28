import type { ParsedArgs } from '../args.js';
import { optionalInt, optionalString } from '../args.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { RegistryMigrationPendingError } from '../../../server/workspace/registry.js';
import { setPluginTrustForDirectory, TrustPluginsError } from '../../../server/workspace/trust-plugins.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * Docker plugin-smoke-test bootstrap: sets the machine-local plugin trust of a
 * project BEFORE the server ever starts, in the global workspace registry
 * (`$C4S_HOME` honoured) — no running server required. Unlike every other CLI
 * command, this does NOT resolve an EXISTING registered project: it mirrors the
 * server's own registration so the project record exists (idempotently) with
 * trust already set, and the server later reuses that SAME record.
 *
 *   c4s trust-plugins --cwd /workspace/project true
 *   c4s trust-plugins --cwd /workspace/project --port 3000 --mode prod true
 *
 * 2.1.58 (M31 `m31cli01`): a `--cwd` that is a project of a workspace with a
 * home directory takes that workspace and the id its committed
 * `workspace.json` gives it; a `--cwd` inside such a home that the file does
 * not list is refused — the CLI never writes that file. Otherwise `--port`
 * (default 4500) picks the registry workspace, as `docker/setup-plugin-env.sh`
 * passes it. Every step lives in the M31 core (`setPluginTrustForDirectory`);
 * this file only parses argv and maps the refusals.
 */
export async function runTrustPlugins(args: ParsedArgs): Promise<void> {
  const cwd = optionalString(args, 'cwd');
  if (!cwd) throw new CliError('INVALID_ARGS', '--cwd is required');

  const valueRaw = args.positional[0];
  if (valueRaw !== 'true' && valueRaw !== 'false') {
    throw new CliError('INVALID_ARGS', `expected a trailing 'true' or 'false', got '${valueRaw ?? ''}'`);
  }

  const port = optionalInt(args, 'port');
  const mode = optionalString(args, 'mode');
  if (mode !== undefined && mode !== 'dev' && mode !== 'prod') {
    throw new CliError('INVALID_ARGS', `--mode must be 'dev' or 'prod', got '${mode}'`);
  }

  let result;
  try {
    result = setPluginTrustForDirectory({
      cwd,
      value: valueRaw === 'true',
      ...(port !== undefined ? { port } : {}),
      ...(mode !== undefined ? { mode } : {}),
    });
  } catch (err) {
    if (err instanceof RegistryMigrationPendingError) {
      throw new CliError(
        'REGISTRY_MIGRATION_PENDING',
        err.message,
        'start the claude4spec server once (`npx @inharness-ai/claude4spec`) — it migrates the registry — then re-run this command',
        { steps: [{ action: 'start-server', command: 'npx @inharness-ai/claude4spec' }, { action: 'rerun' }] },
      );
    }
    if (err instanceof TrustPluginsError) {
      throw new CliError(
        err.code,
        err.message,
        err.hint,
        err.code === 'PROJECT_NOT_IN_WORKSPACE_FILE'
          ? { steps: [{ action: 'add-project', where: 'server UI or workspace.json' }, { action: 'rerun' }] }
          : undefined,
      );
    }
    throw err;
  }
  writeOutput(result, args);
}

export const trustPluginsCommand: CliCommandContribution = {
  name: 'trust-plugins',
  // `registry-write`, not `fs-scoped`: it never resolves a project, it writes
  // the workspace registry directly and creates the project record on demand.
  executionMode: 'registry-write',
  flags: ['cwd', 'port', 'mode'],
  errorCodes: ['INVALID_ARGS', 'REGISTRY_MIGRATION_PENDING', 'PROJECT_NOT_IN_WORKSPACE_FILE', 'WORKSPACE_FILE_INVALID'],
  handler: runTrustPlugins,
};

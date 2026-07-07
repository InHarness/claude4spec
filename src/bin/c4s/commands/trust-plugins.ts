import path from 'node:path';
import type { ParsedArgs } from '../args.js';
import { optionalInt, optionalString } from '../args.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * Docker plugin-smoke-test bootstrap: sets `trustProjectPlugins` for a
 * project BEFORE the server ever starts, by mutating `~/.claude4spec/
 * workspaces.json` (or `$C4S_HOME/workspaces.json`) directly — no running
 * server required. Unlike every other CLI command, this does NOT resolve an
 * EXISTING registered project (`resolveWorkspaceProject` throws
 * `PROJECT_NOT_FOUND` for one that isn't registered yet) — it mirrors the
 * server's own bootstrap (`registry.selectOrCreate` + `registry.registerProject`
 * in `src/server/index.ts`) so the project record exists (idempotently) with
 * trust already set, and the server's own boot-time `registerProject` call
 * later reuses that SAME record (matched by `cwd`) instead of creating a
 * fresh, untrusted one.
 *
 *   c4s trust-plugins --cwd /workspace/project true
 *   c4s trust-plugins --cwd /workspace/project --port 3000 --mode prod true
 *
 * `--port`/`--mode` must match what the server passes to
 * `registry.selectOrCreate` at boot (see `docker/entrypoint.sh`'s
 * `--port`/`--mode prod` flags) so both resolve the SAME workspace — a
 * mismatch would set trust on a workspace the server never looks at.
 */
export async function runTrustPlugins(args: ParsedArgs): Promise<void> {
  const cwdRaw = optionalString(args, 'cwd');
  if (!cwdRaw) throw new CliError('INVALID_ARGS', '--cwd is required');
  const cwd = path.resolve(cwdRaw);

  const valueRaw = args.positional[0];
  if (valueRaw !== 'true' && valueRaw !== 'false') {
    throw new CliError('INVALID_ARGS', `expected a trailing 'true' or 'false', got '${valueRaw ?? ''}'`);
  }
  const value = valueRaw === 'true';

  const port = optionalInt(args, 'port');
  const mode = optionalString(args, 'mode');
  if (mode !== undefined && mode !== 'dev' && mode !== 'prod') {
    throw new CliError('INVALID_ARGS', `--mode must be 'dev' or 'prod', got '${mode}'`);
  }

  const registry = new WorkspaceRegistry();
  const workspace = registry.selectOrCreate({ port, mode: mode as 'dev' | 'prod' | undefined });
  const project = registry.registerProject(workspace, cwd);
  registry.setProjectTrust(workspace, project.id, value);

  writeOutput(
    { workspace: workspace.name, projectId: project.id, cwd, trustProjectPlugins: value },
    args,
  );
}

export const trustPluginsCommand: CliCommandContribution = {
  name: 'trust-plugins',
  executionMode: 'fs-scoped',
  errorCodes: ['INVALID_ARGS'],
  handler: runTrustPlugins,
};

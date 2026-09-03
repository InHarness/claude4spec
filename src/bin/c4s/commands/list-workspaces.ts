import type { ParsedArgs } from '../args.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import {
  listWorkspaces,
  WorkspaceRegistryReadError,
} from '../../../server/workspace/list-workspaces.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * M31 — "which of my workspaces is there, and which server should I start?",
 * answered BEFORE any server runs.
 *
 *   c4s list-workspaces
 *
 * The call is bare. There are no positional arguments and no flags of its own,
 * and the shared `--project` / `--workspace` selectors do not apply: the command
 * does not narrow to one workspace by definition, so it never reaches the
 * project or workspace resolver. Passing them changes nothing about the answer.
 *
 * All the registry knowledge lives in `listWorkspaces()` — this layer only maps
 * one failure onto one CLI code. That is deliberate: `~/.claude4spec/
 * workspaces.json` should not be greppable in `src/bin/`, or the bin becomes a
 * second place that knows the registry's format.
 */
export async function runListWorkspaces(args: ParsedArgs): Promise<void> {
  let workspaces;
  try {
    workspaces = listWorkspaces();
  } catch (err) {
    if (err instanceof WorkspaceRegistryReadError) {
      throw new CliError(
        'REGISTRY_READ_FAILED',
        err.message,
        'repair or remove the registry file, then re-run — nothing is written until you do',
      );
    }
    throw err;
  }
  writeOutput(workspaces, args);
}

export const listWorkspacesCommand: CliCommandContribution = {
  name: 'list-workspaces',
  // `registry-read`: the mirror of `trust-plugins`'s `registry-write`. No server
  // bootstrap, no db slot, no project `cwd` files, no resolver — enforced by this
  // file importing neither `delegate.js` nor `project-selector.js`.
  executionMode: 'registry-read',
  output: {
    unit: 'workspace',
    fields: ['name', 'mode', 'defaultPort', 'projectCount', 'lastOpened'],
  },
  errorCodes: ['REGISTRY_READ_FAILED'],
  handler: runListWorkspaces,
};

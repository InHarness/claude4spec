import {
  resolveWorkspaceProject,
  WorkspaceResolveError,
  type ResolvedWorkspaceProject,
} from '../../core/workspace/resolve.js';
import { CliError } from './errors.js';

/**
 * Registry-only project resolution, for the commands that do not address a
 * server.
 *
 * ## What this replaced
 *
 * `src/bin/c4s/context.ts`, deleted in 0.2.13. That module resolved the project
 * AND opened `db.sqlite` `readonly: true`, built a serialization engine through
 * the plugin loader, and assembled a discovery core — so every read command
 * carried a second implementation of operations the server also implemented.
 * Item 22 removes the second one; what survives of the module is the part that
 * only ever answered "which project", which is the question the two remaining
 * server-free commands still have.
 *
 * Server-delegating commands do NOT come through here. They resolve an ADDRESS
 * (`delegate.ts` → `core/agent/http.ts`), which is a different question with a
 * different failure surface: a project can resolve locally and still not be
 * registered on the server that is running.
 */

/** Maps a caught `WorkspaceResolveError` onto the CLI error surface; rethrows anything else. */
export function mapWorkspaceResolveError(err: unknown): never {
  if (err instanceof WorkspaceResolveError) {
    throw new CliError(err.code, err.message, err.hint);
  }
  throw err;
}

export function resolveWorkspaceProjectOrThrow(args: {
  project?: string;
  workspace?: string;
}): ResolvedWorkspaceProject {
  try {
    return resolveWorkspaceProject({ project: args.project, workspace: args.workspace });
  } catch (err) {
    mapWorkspaceResolveError(err);
  }
}

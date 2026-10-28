import path from 'node:path';
import {
  DEFAULT_WORKSPACE_PORT,
  findProjectByCwd,
  isPathWithin,
  RegistryMigrationPendingError,
  WorkspaceRegistry,
} from './registry.js';
import type { WorkspaceRecord } from './types.js';

/**
 * M31 core of `c4s trust-plugins` (record `trust-plugins`, mode
 * `registry-write`): set the machine-local plugin trust of one project in the
 * global registry, server-free — no server, no db-slot, no write into the
 * project's directory, and never into the committed `workspace.json` of a home
 * (M31 `m31cli01`). The bin keeps only the contribution and the mapping of
 * these refusals onto CLI codes.
 *
 * Steps (the record's `logic`):
 *  1. `cwd` matches a project path in the view of a workspace with a home →
 *     that workspace and the id `workspace.json` gives it; the consent goes to
 *     the entry's `projectTrust`, keyed `(home, id)` with the relative path.
 *  2. `cwd` lies inside a registered home whose `workspace.json` lists no such
 *     path → PROJECT_NOT_IN_WORKSPACE_FILE (unreadable file:
 *     WORKSPACE_FILE_INVALID), before any mutation.
 *  3. otherwise the registry workspace selected by `port` (default 4500) or
 *     created with it → `registerProject` (mints the id under the registry lock
 *     when the directory has no record yet) → `setProjectTrust`.
 */

export type TrustPluginsErrorCode = 'PROJECT_NOT_IN_WORKSPACE_FILE' | 'WORKSPACE_FILE_INVALID' | 'INVALID_ARGS';

export class TrustPluginsError extends Error {
  constructor(
    public readonly code: TrustPluginsErrorCode,
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'TrustPluginsError';
  }
}

export interface TrustPluginsResult {
  workspace: string;
  projectId: string;
  cwd: string;
  trustProjectPlugins: boolean;
}

export function setPluginTrustForDirectory(
  opts: { cwd: string; value: boolean; port?: number; mode?: 'dev' | 'prod' },
  registry: WorkspaceRegistry = new WorkspaceRegistry(),
): TrustPluginsResult {
  // 2.1.0: only the server migrates hash ids (it renames the DB slots too). A
  // write here would persist a registry whose ids no slot matches.
  if (registry.isMigrationPending()) throw new RegistryMigrationPendingError(registry.filePath);
  const cwd = path.resolve(opts.cwd);
  const done = (ws: WorkspaceRecord, projectId: string): TrustPluginsResult => {
    registry.setProjectTrust(ws, projectId, opts.value);
    return { workspace: ws.name, projectId, cwd, trustProjectPlugins: opts.value };
  };

  // 1–2. The registered homes this directory lies in (a deleted checkout
  // contains nothing).
  const views = registry.listWorkspaces();
  const homes = views.filter((w) => w.home !== undefined && w.homeMissing !== true && isPathWithin(w.home, cwd));
  const broken = homes.filter((w) => w.fileError !== undefined);
  if (broken.length > 0) {
    throw new TrustPluginsError(
      'WORKSPACE_FILE_INVALID',
      broken.map((w) => `workspace '${w.name}': ${w.fileError!.message}`).join('; '),
      'fix the file by hand, then re-run — nothing is written until you do',
    );
  }
  for (const ws of homes) {
    const project = findProjectByCwd(ws.projects, cwd);
    if (project) return done(ws, project.id);
  }
  if (homes.length > 0) {
    const ws = homes[0]!;
    throw new TrustPluginsError(
      'PROJECT_NOT_IN_WORKSPACE_FILE',
      `${cwd} lies in the home of workspace '${ws.name}' (${ws.home}), but its workspace.json lists no project at that path; c4s never writes that committed file`,
      `add the project from the server's UI or as an entry of ${path.join(ws.home!, '.claude4spec', 'workspace.json')}, then re-run`,
    );
  }

  // 3. A registry workspace by `defaultPort`, created when none has it.
  const port = opts.port ?? DEFAULT_WORKSPACE_PORT;
  const owner = views.find((w) => w.defaultPort === port);
  if (owner?.home !== undefined) {
    // ASSUMPTION:dev-0403 — the port names a workspace with a home this
    // directory is not inside; registering it there would write workspace.json.
    throw new TrustPluginsError(
      'INVALID_ARGS',
      `--port ${port} selects workspace '${owner.name}', which has a home directory (${owner.home}); ${cwd} is not one of its projects`,
      'pass the --port of a registry workspace, or run the command for a project listed in that workspace.json',
    );
  }
  const ws = registry.selectOrCreate({ port, ...(opts.mode !== undefined ? { mode: opts.mode } : {}) });
  const project = registry.registerProject(ws, cwd);
  return done(ws, project.id);
}

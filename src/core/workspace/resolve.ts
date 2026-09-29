import path from 'node:path';
import {
  WorkspaceRegistry,
  resolvePluginPackages,
  findProjectByCwd,
  findProjectsById,
} from '../../server/workspace/registry.js';
import type { ProjectRecord, WorkspaceRecord } from '../../server/workspace/types.js';
import { localServerUrl } from './network.js';

export interface ResolvedWorkspaceProject {
  workspaceName: string;
  /** 2.1.0: the resolved workspace record (network attributes included). */
  workspace: WorkspaceRecord;
  defaultPort: number;
  /**
   * 2.1.0: the workspace's LOCAL address (loopback `:defaultPort`, or a concrete
   * `bindHost`) — where `c4s` finds the server. Never `publicUrl`.
   */
  localUrl: string;
  projectId: string;
  /** Local directory of the project — CLI-internal, never sent anywhere. */
  projectDir: string;
  /** `~/.claude4spec/<ws>/<id>/db.sqlite` — may not exist yet (fresh slot). */
  dbPath: string;
  /** M33: workspace plugin packages (predefined ∪ user-added) for the loader. */
  pluginPackages: string[];
  /** The resolved registry record (e.g. for `c4s install-skills`). */
  project: ProjectRecord;
}

export type WorkspaceResolveErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'AMBIGUOUS_WORKSPACE'
  | 'PROJECT_ID_NOT_FOUND'
  | 'AMBIGUOUS_PROJECT';

export class WorkspaceResolveError extends Error {
  constructor(
    public code: WorkspaceResolveErrorCode,
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = 'WorkspaceResolveError';
  }
}

/**
 * M31 CLI resolution, 2.1.0 contract. Runs BEFORE any network/db access,
 * purely against `~/.claude4spec/workspaces.json` (a pre-2.1.0 file is seen
 * with its ids migrated in memory — the CLI never migrates it).
 *
 * ONE selector — `--project <id>`, the registry id (same value as in
 * `<workspace_projects>`, the `/api/projects/<id>` prefix and MCP `ask.project`).
 * Never a path, never a display name.
 *   0 matches  → PROJECT_ID_NOT_FOUND, message lists the available ids
 *   1 match    → resolve
 *   N (across workspaces, no --workspace) → AMBIGUOUS_PROJECT, candidates
 *     `{ id, workspace }` — never a directory
 *
 * Without `--project`: implicit walk-up from cwd to the nearest registered
 * project, then the 0/1/N rule on the workspaces owning it:
 *   0 → PROJECT_NOT_FOUND  (hint: run `npx @inharness-ai/claude4spec` here first)
 *   1 → auto-resolve
 *   N>1 without --workspace → AMBIGUOUS_WORKSPACE
 *
 * No last-opened guessing — ambiguity is always explicit.
 */
export function resolveWorkspaceProject(
  opts: { project?: string; workspace?: string } = {},
): ResolvedWorkspaceProject {
  const registry = new WorkspaceRegistry();

  let projectDir: string | null = null;
  let owners: WorkspaceRecord[] = [];
  if (opts.project) {
    const all = registry.listWorkspaces();
    let candidates = all;
    if (opts.workspace) {
      const ws = all.find((w) => w.name === opts.workspace);
      if (!ws) {
        throw new WorkspaceResolveError(
          'PROJECT_NOT_FOUND',
          `workspace '${opts.workspace}' is not registered`,
          `known workspaces: ${all.map((w) => w.name).join(', ') || '(none)'}`,
        );
      }
      candidates = [ws];
    }
    const matches = findProjectsById(candidates, opts.project);
    if (matches.length === 0) {
      const available = candidates.flatMap((w) =>
        w.projects.map((p) => (opts.workspace ? p.id : `${p.id} (workspace '${w.name}')`)),
      );
      throw new WorkspaceResolveError(
        'PROJECT_ID_NOT_FOUND',
        `no project with id '${opts.project}'${opts.workspace ? ` in workspace '${opts.workspace}'` : ''}; available ids: ${
          available.join(', ') || '(none)'
        }`,
        'pass --project <id> exactly as the registry lists it (`c4s list-workspaces`); a skill carrying a stale id must be regenerated',
      );
    }
    if (matches.length > 1) {
      const candidatesJson = matches.map((m) => ({ id: m.project.id, workspace: m.workspace.name }));
      throw new WorkspaceResolveError(
        'AMBIGUOUS_PROJECT',
        `project id '${opts.project}' exists in ${matches.length} workspaces: ${JSON.stringify(candidatesJson)}`,
        'pass --workspace <name> to pick one',
      );
    }
    const match = matches[0]!;
    return buildResolved(registry, match.workspace, match.project);
  }

  let dir = process.cwd();
  for (;;) {
    const found = registry.resolveWorkspacesForCwd(dir);
    if (found.length > 0) {
      projectDir = dir;
      owners = found;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (!projectDir || owners.length === 0) {
    throw new WorkspaceResolveError(
      'PROJECT_NOT_FOUND',
      'no workspace owns a claude4spec project in the current directory or any parent',
      'run `npx @inharness-ai/claude4spec` here first (it registers the project in a workspace)',
    );
  }

  let workspace: WorkspaceRecord;
  if (opts.workspace) {
    const match = owners.find((w) => w.name === opts.workspace);
    if (!match) {
      throw new WorkspaceResolveError(
        'PROJECT_NOT_FOUND',
        `project ${projectDir} is not registered in workspace '${opts.workspace}'`,
        `registered in: ${owners.map((w) => w.name).join(', ')}`,
      );
    }
    workspace = match;
  } else if (owners.length === 1) {
    workspace = owners[0]!;
  } else {
    throw new WorkspaceResolveError(
      'AMBIGUOUS_WORKSPACE',
      `project ${projectDir} is registered in ${owners.length} workspaces: ${owners
        .map((w) => `'${w.name}' (port ${w.defaultPort})`)
        .join(', ')}`,
      'pass --workspace <name> to pick one',
    );
  }

  // Read the STORED id off the matched record — never derived from the path.
  const record = findProjectByCwd(workspace.projects, projectDir)!;
  return buildResolved(registry, workspace, record);
}

function buildResolved(
  registry: WorkspaceRegistry,
  workspace: WorkspaceRecord,
  project: ProjectRecord,
): ResolvedWorkspaceProject {
  return {
    workspaceName: workspace.name,
    workspace,
    defaultPort: workspace.defaultPort,
    localUrl: localServerUrl(workspace),
    projectId: project.id,
    projectDir: project.cwd,
    dbPath: path.join(registry.slotDir(workspace, project.id), 'db.sqlite'),
    pluginPackages: resolvePluginPackages(workspace),
    project,
  };
}

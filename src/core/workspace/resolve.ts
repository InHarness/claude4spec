import path from 'node:path';
import { WorkspaceRegistry, resolvePluginPackages } from '../../server/workspace/registry.js';
import { projectIdForCwd } from '../../server/workspace/project-id.js';
import type { WorkspaceRecord } from '../../server/workspace/types.js';

export interface ResolvedWorkspaceProject {
  workspaceName: string;
  defaultPort: number;
  projectId: string;
  projectDir: string;
  /** `~/.claude4spec/<ws>/<id>/db.sqlite` — may not exist yet (fresh slot). */
  dbPath: string;
  /** M33: workspace plugin packages (predefined ∪ user-added) for the loader. */
  pluginPackages: string[];
}

export type WorkspaceResolveErrorCode = 'PROJECT_NOT_FOUND' | 'AMBIGUOUS_WORKSPACE';

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
 * M31 CLI resolution — replaces the pre-workspace walk-up resolvers. Runs
 * BEFORE any network/db access, purely against `~/.claude4spec/workspaces.json`.
 *
 * 0/1/N rule on the workspaces owning the resolved project dir:
 *   0 → PROJECT_NOT_FOUND  (hint: run `npx @inharness-ai/claude4spec` here first)
 *   1 → auto-resolve
 *   N>1 without --workspace → AMBIGUOUS_WORKSPACE listing candidates
 *
 * No last-opened guessing — ambiguity is always explicit.
 */
export function resolveWorkspaceProject(
  opts: { project?: string; workspace?: string } = {},
): ResolvedWorkspaceProject {
  const registry = new WorkspaceRegistry();

  // Project dir: explicit --project, else walk-up from cwd against the
  // registry (a subdirectory of a registered project resolves to its root).
  let projectDir: string | null = null;
  let owners: WorkspaceRecord[] = [];
  if (opts.project) {
    projectDir = path.resolve(process.cwd(), opts.project);
    owners = registry.resolveWorkspacesForCwd(projectDir);
  } else {
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
  }

  if (!projectDir || owners.length === 0) {
    throw new WorkspaceResolveError(
      'PROJECT_NOT_FOUND',
      opts.project
        ? `no workspace owns a claude4spec project at ${path.resolve(process.cwd(), opts.project)}`
        : 'no workspace owns a claude4spec project in the current directory or any parent',
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

  // Read the STORED id off the matched record — never re-derive from the path,
  // so a project whose id diverged from sha1(cwd) still resolves to its slot.
  // sha1(cwd) is only a fallback for a record that somehow lacks the field.
  const record =
    workspace.projects.find((p) => p.cwd === projectDir) ??
    workspace.projects.find((p) => p.id === projectIdForCwd(projectDir));
  const projectId = record?.id ?? projectIdForCwd(projectDir);
  return {
    workspaceName: workspace.name,
    defaultPort: workspace.defaultPort,
    projectId,
    projectDir,
    dbPath: path.join(registry.slotDir(workspace, projectId), 'db.sqlite'),
    pluginPackages: resolvePluginPackages(workspace),
  };
}

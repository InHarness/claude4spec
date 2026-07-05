import path from 'node:path';
import {
  WorkspaceRegistry,
  resolvePluginPackages,
  findProjectByCwd,
  findProjectByName,
} from '../../server/workspace/registry.js';
import { projectIdForCwd } from '../../server/workspace/project-id.js';
import type { ProjectRecord, WorkspaceRecord } from '../../server/workspace/types.js';

export interface ResolvedWorkspaceProject {
  workspaceName: string;
  defaultPort: number;
  projectId: string;
  projectDir: string;
  /** `~/.claude4spec/<ws>/<id>/db.sqlite` — may not exist yet (fresh slot). */
  dbPath: string;
  /** M33: workspace plugin packages (predefined ∪ user-added) for the loader. */
  pluginPackages: string[];
  /**
   * 0.1.104: the resolved registry record — e.g. for `c4s install-skills`,
   * which needs `ProjectRecord.name` (the injected `--project <slug>`
   * identity) without a second registry read (see `buildExternalSkillContext`'s
   * own doc comment on why that'd reintroduce the 0/1/N ambiguity this
   * resolver already settled once).
   */
  project: ProjectRecord;
}

export type WorkspaceResolveErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'AMBIGUOUS_WORKSPACE'
  | 'PROJECT_SLUG_NOT_FOUND'
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
 * M31 CLI resolution — replaces the pre-workspace walk-up resolvers. Runs
 * BEFORE any network/db access, purely against `~/.claude4spec/workspaces.json`.
 *
 * 0/1/N rule on the workspaces owning the resolved project dir (no-`--project`
 * walk-up only):
 *   0 → PROJECT_NOT_FOUND  (hint: run `npx @inharness-ai/claude4spec` here first)
 *   1 → auto-resolve
 *   N>1 without --workspace → AMBIGUOUS_WORKSPACE listing candidates
 *
 * No last-opened guessing — ambiguity is always explicit.
 *
 * `--project` accepts a PATH first (unchanged, backward-compatible
 * behavior — resolved against cwd, looked up by stored `cwd`/`sha1(cwd)`
 * id). Only when that resolves to zero owners does it fall back to treating
 * the value as a registered project's `name` — a cosmetic, non-unique
 * `basename(cwd)`-derived label users see in `workspaces.json`, and the same
 * "slug" identity M22 injects (`--project <slug> --workspace <name>`) into
 * externally-copied SKILL.md files — scoped to `--workspace` when given
 * (explicit, never silently widened), else searched across every workspace:
 *   0 matches  → PROJECT_SLUG_NOT_FOUND (the injected identity no longer
 *     matches a project in this machine's registry — regenerate the skill)
 *   1 match    → auto-resolve
 *   N>1 matches without --workspace → AMBIGUOUS_PROJECT listing candidates
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
    if (owners.length === 0) {
      let candidateWorkspaces: WorkspaceRecord[];
      if (opts.workspace) {
        const ws = registry.getWorkspace(opts.workspace);
        if (!ws) {
          // Distinguish "the --workspace value itself is unrecognized" from
          // the name-fallback's own PROJECT_SLUG_NOT_FOUND below — otherwise
          // a typo'd --workspace gets misdiagnosed as a stale --project slug
          // and the (wrong) "regenerate the skill" hint.
          throw new WorkspaceResolveError(
            'PROJECT_NOT_FOUND',
            `workspace '${opts.workspace}' is not registered`,
            `known workspaces: ${registry.listWorkspaces().map((w) => w.name).join(', ') || '(none)'}`,
          );
        }
        candidateWorkspaces = [ws];
      } else {
        candidateWorkspaces = registry.listWorkspaces();
      }
      const matches = findProjectByName(candidateWorkspaces, opts.project);
      if (matches.length === 1) {
        projectDir = matches[0]!.project.cwd;
        owners = [matches[0]!.workspace];
      } else if (matches.length > 1) {
        throw new WorkspaceResolveError(
          'AMBIGUOUS_PROJECT',
          `project name '${opts.project}' matches ${matches.length} projects: ${matches
            .map((m) => `'${m.workspace.name}' (${m.project.cwd})`)
            .join(', ')}`,
          'pass --workspace <name> to pick one, or use --project <path> instead of a name',
        );
      } else {
        throw new WorkspaceResolveError(
          'PROJECT_SLUG_NOT_FOUND',
          `no workspace owns a claude4spec project at ${projectDir} (and no registered project is named '${opts.project}')`,
          "the injected --project <slug> no longer matches a project in this machine's registry — regenerate the skill from the spec repo project, or pass --project <path> instead of a slug",
        );
      }
    }
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

  // Read the STORED id off the matched record — never re-derive from the path,
  // so a project whose id diverged from sha1(cwd) still resolves to its slot.
  // sha1(cwd) is only a fallback for a record that somehow lacks the field.
  const record = findProjectByCwd(workspace.projects, projectDir);
  const projectId = record?.id ?? projectIdForCwd(projectDir);
  const project: ProjectRecord = record ?? {
    cwd: projectDir,
    id: projectId,
    name: path.basename(projectDir),
    addedAt: new Date().toISOString(),
  };
  return {
    workspaceName: workspace.name,
    defaultPort: workspace.defaultPort,
    projectId,
    projectDir,
    dbPath: path.join(registry.slotDir(workspace, projectId), 'db.sqlite'),
    pluginPackages: resolvePluginPackages(workspace),
    project,
  };
}

import fs from 'node:fs';
import path from 'node:path';
import {
  WorkspaceRegistry,
  resolvePluginPackages,
  findProjectByCwd,
  isPathWithin,
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
  | 'AMBIGUOUS_PROJECT'
  // 2.1.58 (M11 `m11pjres`, `tcs1yuku`) — `cli` channel only.
  | 'WORKSPACE_NOT_REGISTERED'
  | 'WORKSPACE_FILE_INVALID';

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

/** The project marker — proof that a directory is a project, never read for content. */
const PROJECT_MARKER = path.join('.claude4spec', 'config.json');
/** The committed description of a workspace with a home directory. */
const WORKSPACE_FILE = path.join('.claude4spec', 'workspace.json');

/** `dir` itself or the nearest ancestor for which `test` holds, or `null`. */
function findUp(from: string, test: (dir: string) => boolean): string | null {
  let dir = from;
  for (;;) {
    if (test(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * A view whose composition could not be read from an EXISTING home: its
 * `workspace.json` is unreadable or off the shape. A home that is gone (a
 * deleted checkout) holds no project anybody can stand in and is not a file to
 * repair, so it reads as empty instead.
 */
function hasBrokenFile(w: WorkspaceRecord): boolean {
  return w.fileError !== undefined && w.homeMissing !== true;
}

function workspaceFileInvalid(broken: readonly WorkspaceRecord[], workspaceHint: boolean): WorkspaceResolveError {
  return new WorkspaceResolveError(
    'WORKSPACE_FILE_INVALID',
    broken.map((w) => `workspace '${w.name}': ${w.fileError!.message}`).join('; '),
    `fix the file by hand (nothing repairs it for you), then re-run${
      workspaceHint ? ' — or pass --workspace <name> to address a workspace whose description reads' : ''
    }`,
  );
}

/**
 * M31 CLI resolution. Runs BEFORE any network/db access, purely against local
 * files: `~/.claude4spec/workspaces.json` (a pre-2.1.0 file is seen with its ids
 * migrated in memory — the CLI never migrates it), the committed
 * `<home>/.claude4spec/workspace.json` of every registered workspace with a
 * home, and the project marker `.claude4spec/config.json` (existence only).
 *
 * 2.1.58 (M11 `m11pjres`, `m11wsres`): matching a path and looking an id up go
 * over the workspace VIEWS of both kinds — a registry entry's `projects[]`, and
 * the paths of a home's `workspace.json` resolved against the home. Each view is
 * read once per call.
 *
 * ONE selector — `--project <id>`, the id the view lists (same value as in
 * `<workspace_projects>`, the `/api/projects/<id>` prefix and MCP `ask.project`).
 * Never a path, never a display name.
 *   0 matches  → PROJECT_ID_NOT_FOUND, message lists the available ids
 *   1 match    → resolve
 *   N (across workspaces, no --workspace) → AMBIGUOUS_PROJECT, candidates
 *     `{ id, workspace }` — never a directory
 *
 * Without `--project`: walk up from cwd to the nearest project marker, then the
 * 0/1/N rule on the workspaces whose view holds that directory:
 *   0 → keep walking, past the marker, to the nearest `workspace.json`:
 *       a home this machine has not registered → WORKSPACE_NOT_REGISTERED
 *       (hint: start the server once with `--cwd <home>`); the cwd IS a
 *       registered home → PROJECT_NOT_FOUND naming that workspace's project ids
 *       (no paths); anything else → PROJECT_NOT_FOUND
 *   1 → auto-resolve
 *   N>1 without --workspace → AMBIGUOUS_WORKSPACE
 *
 * A registered home whose `workspace.json` cannot be read is WORKSPACE_FILE_INVALID
 * whenever the answer depends on that file: for the walk-up, when the directory
 * lies inside that home; for `--project`, when that workspace is among the
 * candidates (its file could list the id) — ASSUMPTION:dev-0402. This replaces
 * the PROJECT_* miss with an `unreadable:` suffix (dev-0103) on the `cli` path.
 *
 * No last-opened guessing — ambiguity is always explicit.
 *
 * 2.1.53 — the 0/1/N rule is the `cli` channel's alone: it is the one caller
 * with no workspace of its own. `mcp` / `internal` callers run inside a server
 * process, which belongs to exactly one workspace, so they resolve `project` in
 * `workspace` (the serving workspace, or the one the caller named to reach
 * elsewhere) and nowhere else. That path never raises PROJECT_NOT_FOUND, an
 * AMBIGUOUS_* code or a WORKSPACE_* code: a workspace that is not registered
 * holds no such id either, so both misses are PROJECT_ID_NOT_FOUND.
 */
export function resolveWorkspaceProject(
  opts: { project?: string; workspace?: string; channel?: 'cli' | 'mcp' | 'internal' } = {},
): ResolvedWorkspaceProject {
  const registry = new WorkspaceRegistry();
  if (opts.channel !== undefined && opts.channel !== 'cli') {
    return resolveInServingWorkspace(registry, opts.project ?? '', opts.workspace);
  }
  const views = registry.listWorkspaces();
  return opts.project
    ? resolveById(registry, views, opts.project, opts.workspace)
    : resolveByWalkUp(registry, views, opts.workspace);
}

function resolveById(
  registry: WorkspaceRegistry,
  views: WorkspaceRecord[],
  id: string,
  workspaceName: string | undefined,
): ResolvedWorkspaceProject {
  let candidates = views;
  if (workspaceName) {
    const ws = views.find((w) => w.name === workspaceName);
    if (!ws) {
      throw new WorkspaceResolveError(
        'PROJECT_NOT_FOUND',
        `workspace '${workspaceName}' is not registered`,
        `known workspaces: ${views.map((w) => w.name).join(', ') || '(none)'}`,
      );
    }
    candidates = [ws];
  }
  // A candidate whose description cannot be read could list this id: neither a
  // miss nor a single hit elsewhere can be told apart from an ambiguity.
  const broken = candidates.filter(hasBrokenFile);
  if (broken.length > 0) throw workspaceFileInvalid(broken, !workspaceName);

  const matches = findProjectsById(candidates, id);
  if (matches.length === 0) {
    const available = candidates.flatMap((w) =>
      w.projects.map((p) => (workspaceName ? p.id : `${p.id} (workspace '${w.name}')`)),
    );
    throw new WorkspaceResolveError(
      'PROJECT_ID_NOT_FOUND',
      `no project with id '${id}'${workspaceName ? ` in workspace '${workspaceName}'` : ''}; available ids: ${
        available.join(', ') || '(none)'
      }`,
      'pass --project <id> exactly as the registry lists it (`c4s list-workspaces`); a skill carrying a stale id must be regenerated',
    );
  }
  if (matches.length > 1) {
    const candidatesJson = matches.map((m) => ({ id: m.project.id, workspace: m.workspace.name }));
    throw new WorkspaceResolveError(
      'AMBIGUOUS_PROJECT',
      `project id '${id}' exists in ${matches.length} workspaces: ${JSON.stringify(candidatesJson)}`,
      'pass --workspace <name> to pick one',
    );
  }
  const match = matches[0]!;
  return buildResolved(registry, match.workspace, match.project);
}

function resolveByWalkUp(
  registry: WorkspaceRegistry,
  views: WorkspaceRecord[],
  workspaceName: string | undefined,
): ResolvedWorkspaceProject {
  const cwd = path.resolve(process.cwd());
  const projectDir = findUp(cwd, (d) => fs.existsSync(path.join(d, PROJECT_MARKER)));
  const owners = projectDir ? registry.resolveWorkspacesForCwd(projectDir, views) : [];

  // The directory lies in a registered home whose description cannot be read:
  // that file decides whether (and how often) the project is listed. A named
  // workspace that does hold the project still resolves.
  const at = projectDir ?? cwd;
  const broken = views.filter((w) => w.home !== undefined && hasBrokenFile(w) && isPathWithin(w.home, at));
  if (broken.length > 0 && !(workspaceName && owners.some((w) => w.name === workspaceName))) {
    throw workspaceFileInvalid(broken, false);
  }

  if (!projectDir || owners.length === 0) throw projectNotFound(views, projectDir ?? cwd, cwd);

  let workspace: WorkspaceRecord;
  if (workspaceName) {
    const match = owners.find((w) => w.name === workspaceName);
    if (!match) {
      throw new WorkspaceResolveError(
        'PROJECT_NOT_FOUND',
        `project ${projectDir} is not registered in workspace '${workspaceName}'`,
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

  // Read the STORED id off the matched view — never derived from the path.
  const record = findProjectByCwd(workspace.projects, projectDir)!;
  return buildResolved(registry, workspace, record);
}

/**
 * Zero workspaces hold the directory. Before answering PROJECT_NOT_FOUND the
 * walk-up goes on, past the project marker, to the nearest `workspace.json`:
 * without that step a freshly cloned team repo would read as "no project here".
 */
function projectNotFound(views: WorkspaceRecord[], from: string, cwd: string): WorkspaceResolveError {
  const home = findUp(from, (d) => fs.existsSync(path.join(d, WORKSPACE_FILE)));
  if (home !== null) {
    const registered = views.find((w) => w.home !== undefined && path.resolve(w.home) === home);
    if (!registered) {
      return new WorkspaceResolveError(
        'WORKSPACE_NOT_REGISTERED',
        `${path.join(home, WORKSPACE_FILE)} describes a workspace this machine has not registered`,
        `start the server once with \`--cwd ${home}\` (\`npx @inharness-ai/claude4spec --cwd ${home}\`), then re-run`,
      );
    }
    if (cwd === home) {
      // The home itself is no project. Ids only — a project's directory is a
      // fact of the server, never part of an answer (M31 `u4g9p66c`).
      return new WorkspaceResolveError(
        'PROJECT_NOT_FOUND',
        `the current directory is the home of workspace '${registered.name}', not a project; its project ids: ${
          registered.projects.map((p) => p.id).join(', ') || '(none)'
        }`,
        'run c4s inside one of its projects, or pass --project <id>',
      );
    }
  }
  return new WorkspaceResolveError(
    'PROJECT_NOT_FOUND',
    'no workspace owns a claude4spec project (.claude4spec/config.json) in the current directory or any parent',
    'run `npx @inharness-ai/claude4spec` (it registers projects in a workspace), or add the project to a workspace',
  );
}

function resolveInServingWorkspace(
  registry: WorkspaceRegistry,
  project: string,
  workspace: string | undefined,
): ResolvedWorkspaceProject {
  const ws = workspace ? registry.getWorkspace(workspace) : null;
  const hit = ws?.projects.find((p) => p.id === project);
  if (!ws || !hit) {
    const available = ws?.projects.map((p) => p.id) ?? [];
    throw new WorkspaceResolveError(
      'PROJECT_ID_NOT_FOUND',
      ws
        ? `no project with id '${project}' in workspace '${ws.name}'; available ids: ${available.join(', ') || '(none)'}${
            ws.fileError ? `; unreadable: ${ws.fileError.message}` : ''
          }`
        : `no project with id '${project}': workspace '${workspace ?? '(none)'}' is not registered`,
      'pass `project` exactly as <workspace_projects/> lists it, and `workspace` only to reach a peer in another workspace',
    );
  }
  return buildResolved(registry, ws, hit);
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

import path from 'node:path';
import { SKILL_NAME_RE } from '../services/skill-name.js';
import {
  DEFAULT_WORKSPACE_PORT,
  findProjectByCwd,
  isPathWithin,
  RegistryMigrationPendingError,
  WorkspaceRegistry,
  type SkillUsesConfirmationResult,
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

/**
 * Steps 1–3 of the record's `logic`, shared by `trust-plugins` and (2.1.67)
 * `confirm-skill-uses`: the workspace and the project id a `--cwd` names. A
 * registry workspace's project is registered on demand (step 3); a project of
 * a workspace with a home must already stand in its `workspace.json` (step 2).
 * Every refusal is raised before anything is written.
 */
export function resolveProjectForDirectory(
  opts: { cwd: string; port?: number; mode?: 'dev' | 'prod' },
  registry: WorkspaceRegistry,
): { ws: WorkspaceRecord; projectId: string; cwd: string } {
  // 2.1.0: only the server migrates hash ids (it renames the DB slots too). A
  // write here would persist a registry whose ids no slot matches.
  if (registry.isMigrationPending()) throw new RegistryMigrationPendingError(registry.filePath);
  const cwd = path.resolve(opts.cwd);

  // 1–2. The registered homes this directory lies in (a deleted checkout
  // contains nothing) — an entry `register-home` wrote a moment ago included.
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
    if (project) return { ws, projectId: project.id, cwd };
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
  // 2.1.69 (M31 `m31cli01`): a registry-write command does not open the
  // workspace — neither `lastOpened` nor `lastOpenedProject` is stamped, so an
  // idempotent repeat changes nothing in the registry.
  const ws = registry.selectOrCreate({ port, open: false, ...(opts.mode !== undefined ? { mode: opts.mode } : {}) });
  const project = registry.registerProject(ws, cwd);
  return { ws, projectId: project.id, cwd };
}

export function setPluginTrustForDirectory(
  opts: { cwd: string; value: boolean; port?: number; mode?: 'dev' | 'prod' },
  registry: WorkspaceRegistry = new WorkspaceRegistry(),
): TrustPluginsResult {
  const { ws, projectId, cwd } = resolveProjectForDirectory(opts, registry);
  registry.setProjectTrust(ws, projectId, opts.value);
  return { workspace: ws.name, projectId, cwd, trustProjectPlugins: opts.value };
}

/**
 * 2.1.67 — M31 core of `c4s confirm-skill-uses` (record `confirm-skill-uses`,
 * mode `registry-write`): steps 1–3 of `trust-plugins`, ending in
 * `setSkillUsesConfirmation` instead of `setProjectTrust`. `names: []` is the
 * `--clear` of the command. A name outside the `skill.name` syntax (kebab-case,
 * M52) is refused with `INVALID_ARGS` before the registry is even read.
 */
export function confirmSkillUsesForDirectory(
  opts: { cwd: string; names: readonly string[]; port?: number },
  registry: WorkspaceRegistry = new WorkspaceRegistry(),
): SkillUsesConfirmationResult {
  const bad = opts.names.filter((n) => !SKILL_NAME_RE.test(n));
  if (bad.length > 0) {
    throw new TrustPluginsError(
      'INVALID_ARGS',
      `not a skill.name (kebab-case: lowercase letters, digits and single hyphens): ${bad.map((n) => `'${n}'`).join(', ')}`,
      'pass the names exactly as the skill.uses of the project lists them',
    );
  }
  const { ws, projectId } = resolveProjectForDirectory(opts, registry);
  const result = registry.setSkillUsesConfirmation(ws, projectId, opts.names);
  // The project was resolved (or registered) a moment ago; a null here means
  // the entry vanished under us — a race, not a refusal of the contract.
  if (!result) throw new Error(`project '${projectId}' of workspace '${ws.name}' disappeared while writing the confirmation`);
  return result;
}

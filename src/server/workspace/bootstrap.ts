import { RootRegistry } from '../roots/registry.js';
import { PAGES_KIND } from '../../shared/root-kinds.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  configMigrationPending,
  configPath,
  loadOrCreateConfig,
  migrateConfigToV3,
  migrateConfigToV4,
  readConfig,
  validateRootDirs,
  type NormalizedConfig,
} from '../config.js';
import { toProjectPath, workspaceFilePath } from './home-workspace.js';
import { ensureGitignore } from '../../bin/gitignore.js';
import { BOOTSTRAP_TEMPLATE } from '../../bin/bootstrap-template.js';
import { legacyDbToMove, migrateLegacyDbIfNeeded } from './db-migration.js';
import { readRenameJournal, recoverPendingRootRename } from '../root-renames.js';
import type { WorkspaceRegistry } from './registry.js';
import type { ProjectRecord, WorkspaceRecord } from './types.js';

/** What the activation's file steps (M01 `dsh8ezbz` steps 1–6) leave behind. */
export interface ActivationResult {
  config: NormalizedConfig;
  configPath: string;
  /** Did THIS activation write `config.json`? */
  configCreated: boolean;
}

export interface BootstrapResult extends ActivationResult {
  project: ProjectRecord;
}

/**
 * 0.1.56: welcome `pages/index.md` is no longer written at fresh bootstrap — it
 * is deferred to onboarding close (confirm or skip) so a `pagesDir` change in
 * onboarding can't orphan an index at the old path. The PATCH /api/config
 * handler calls this after persisting `onboardingCompleted: true`, on the
 * effective pagesDir; activation calls it for a project whose onboarding is
 * already closed (one from before onboarding included — M01 activation, the
 * welcome-page step). Idempotent: skips if `index.md` exists or pagesDir is
 * non-empty (don't clobber existing pages).
 */
export function ensureWelcomePage(cwd: string, pagesDir: string): void {
  // 0.2.101: the caller passes the BASE root's effective dir (found by the
  // `builtin` flag) — no `'pages'` fallback, which would plant the welcome page
  // in a directory the project may not use at all.
  const pagesPath = path.join(cwd, pagesDir);
  fs.mkdirSync(pagesPath, { recursive: true });
  const indexPath = path.join(pagesPath, 'index.md');
  if (fs.existsSync(indexPath)) return;
  const existing = fs.readdirSync(pagesPath).filter((name) => !name.startsWith('.'));
  if (existing.length > 0) return;
  fs.writeFileSync(indexPath, BOOTSTRAP_TEMPLATE, 'utf8');
}

/**
 * 2.1.58 (M01 `7yzhxgmw`, `dsh8ezbz` step 1): a directory whose `.claude4spec/`
 * carries `workspace.json` is the home of a workspace (M31 `k1gjmnhy`), not a
 * project — its activation is refused before anything is written.
 */
export class WorkspaceHomeNotProjectError extends Error {
  readonly code = 'WORKSPACE_HOME_NOT_PROJECT';
  constructor(readonly dir: string) {
    super(`${dir} is the home directory of a workspace (its .claude4spec/ carries workspace.json), not a project`);
    this.name = 'WorkspaceHomeNotProjectError';
  }
}

/**
 * 2.1.60 (M01 `dsh8ezbz` step 1): a project directory that does not exist is
 * refused — the build ends in the error state and the directory is NOT created.
 */
export class ProjectDirMissingError extends Error {
  readonly code = 'PROJECT_DIR_MISSING';
  constructor(readonly dir: string) {
    super(`project directory ${dir} does not exist`);
    this.name = 'ProjectDirMissingError';
  }
}

/**
 * Step 1 of a REGISTERED project's build — the background build and the
 * activation on a request alike: a workspace home and a directory that does
 * not exist are refused before anything is read or written. (Registration
 * refuses a missing directory earlier, at the route — `unusableDirectoryReason`.)
 */
function refuseNonProjectDir(cwd: string): void {
  if (fs.existsSync(workspaceFilePath(cwd))) throw new WorkspaceHomeNotProjectError(cwd);
  let isDir = false;
  try {
    isDir = fs.statSync(cwd).isDirectory();
  } catch {
    /* absent, or unreadable as a directory */
  }
  if (!isDir) throw new ProjectDirMissingError(cwd);
}

/**
 * 2.1.60 (M01 `dsh8ezbz`, «Budowa w tle a aktywacja»): why a project's
 * background build stops at «needs activation» — each one a step that would
 * write into the project directory:
 *  - `config-missing`   — no `config.json` (step 4 would write a fresh file);
 *  - `config-migration` — a config migration with a write (M26 `hozcm4w5`: the
 *    v4/v3 rewrite, or the replay of an interrupted root rename);
 *  - `legacy-db`        — a database found in the project directory, to be
 *    moved to the slot (step 7);
 *  - `text-migration`   — the one-time migration to text (step 8): entities,
 *    legacy plans or releases held only in the database, or entity files
 *    without the timestamps the backfill writes. Found by the build itself,
 *    once the slot database is open ({@link ProjectNeedsActivationError}).
 */
export type ActivationNeed = 'config-missing' | 'config-migration' | 'legacy-db' | 'text-migration';

/**
 * 2.1.60: thrown by a background context build (`projectWrites: 'none'`) that
 * reached a step which would write into the project directory. Not a failure:
 * {@link backgroundBuild} turns it into the «needs activation» state.
 */
export class ProjectNeedsActivationError extends Error {
  readonly code = 'PROJECT_NEEDS_ACTIVATION';
  constructor(readonly needs: readonly ActivationNeed[]) {
    super(`project needs activation (${needs.join(', ')})`);
    this.name = 'ProjectNeedsActivationError';
  }
}

/** The outcome of the background build's activation steps ({@link backgroundActivationSteps}). */
export type BackgroundStepsResult =
  | { state: 'ready'; config: NormalizedConfig }
  | { state: 'needs-activation'; needs: ActivationNeed[] };

/**
 * 2.1.60 (M01 `dsh8ezbz`, M31 `m31ctx001`): the activation's steps as the
 * background context build runs them — WITHOUT writing into the project
 * directory. A broken project (a workspace home, a missing directory, a
 * malformed or unmigratable `config.json`, colliding roots) throws: the error
 * state. A project that needs a write ends in «needs activation» and nothing is
 * written. Otherwise the one permitted write follows — the missing directories
 * of the registry roots (step 5), only because the config file exists — and
 * the project is ready for the build. Skipped, never needed for «ready»: the
 * internal directory (step 2 — it holds the existing config), the managed
 * `.gitignore` block and the welcome page (step 6); the activation writes them.
 * ASSUMPTION:dev-0003 — which writes count as «needs activation» and which are
 * merely skipped by the background build.
 */
export function backgroundActivationSteps(
  registry: WorkspaceRegistry,
  project: ProjectRecord,
): BackgroundStepsResult {
  const cwd = project.cwd;
  refuseNonProjectDir(cwd);
  const needs: ActivationNeed[] = [];
  if (!fs.existsSync(configPath(cwd))) needs.push('config-missing');
  else if (readRenameJournal(cwd) !== null || configMigrationPending(cwd)) needs.push('config-migration');
  if (legacyDbToMove(registry, cwd, project.id) !== null) needs.push('legacy-db');
  if (needs.length > 0) return { state: 'needs-activation', needs };

  // Step 3: the file is validated (malformed JSON / a type mismatch throws);
  // step 5: the registry's roots — collisions refused before anything else.
  const config = readConfig(cwd);
  const { errors } = validateRootDirs(config.roots);
  if (errors.length > 0) throw new Error(errors[0]);
  for (const root of new RootRegistry(config.roots).list()) {
    const abs = path.resolve(cwd, root.dir);
    if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
  }
  return { state: 'ready', config };
}

/** What a background build of one project ends in, short of an error (which rejects). */
export type BackgroundBuildResult<T> =
  | { state: 'ready'; context: T }
  | { state: 'needs-activation'; needs: ActivationNeed[] };

/**
 * 2.1.60 (M01 `dsh8ezbz`, M31 `m31ctx001`): one project's build in the
 * background mode — the activation's steps without writes
 * ({@link backgroundActivationSteps}), then the context build, which the caller
 * runs with `projectWrites: 'none'` (handed to `build`, with the queue's
 * abort `signal` — the process shutdown interrupts the build). Resolves «ready» with
 * the context, or «needs activation» (from the steps, or from a build that met
 * a migration to text — the partial build is released by the build itself).
 * Rejects on any error: a missing directory is that build's
 * {@link ProjectDirMissingError}, and the directory is not created.
 */
export function backgroundBuild<T>(
  registry: WorkspaceRegistry,
  build: (project: ProjectRecord, mode: { projectWrites: 'none'; signal?: AbortSignal }) => Promise<T>,
): (project: ProjectRecord, signal?: AbortSignal) => Promise<BackgroundBuildResult<T>> {
  return async (project, signal) => {
    const steps = backgroundActivationSteps(registry, project);
    if (steps.state === 'needs-activation') return steps;
    try {
      return { state: 'ready', context: await build(project, { projectWrites: 'none', signal }) };
    } catch (err) {
      if (err instanceof ProjectNeedsActivationError) return { state: 'needs-activation', needs: [...err.needs] };
      throw err;
    }
  };
}

/**
 * 2.1.58 (M01 `dsh8ezbz`): the activation's file steps for one project
 * directory — idempotent, each step creates only what is missing, and no flag
 * is read: the directory comes from the workspace view, the config from the
 * file and the defaults alone.
 *
 *  1. refuse a workspace home (`.claude4spec/workspace.json`);
 *  2. create the internal `.claude4spec/` (`loadOrCreateConfig`);
 *  3. merge the config — rename recovery, the v4/v3 migrations (v3 carries a
 *     legacy port/mode to the registry, first-wins), then a missing file is an
 *     empty contribution and a present one is validated (malformed JSON or a
 *     type mismatch throws, never an empty config);
 *  4. write a fresh file from the defaults (bootstrap key set only, onboarding
 *     open) when there was none — an existing file is never rewritten;
 *     the managed `.gitignore` block follows the roots;
 *  5. create the directory of every registry root;
 *  6. the welcome page, only once onboarding has closed.
 *
 * The database (step 7) and the context (8–9) follow in {@link activateProject}
 * and the context build.
 */
export function activateProjectDir(
  registry: WorkspaceRegistry,
  workspace: WorkspaceRecord,
  cwd: string,
): ActivationResult {
  if (fs.existsSync(workspaceFilePath(cwd))) throw new WorkspaceHomeNotProjectError(cwd);
  // 0.2.8: migrations run BEFORE `loadOrCreateConfig`, not after. That function
  // validates the file it reads, so on exactly the outdated shapes a migration
  // exists to repair it threw first and the repair never ran.
  //
  // v4 BEFORE v3, deliberately. Both end by reading the config back, so
  // whichever runs first must leave the file loadable — and v4 is the one that
  // repairs the shapes the loader rejects (incomplete `roots[]`). v3 still
  // harvests `port`/`mode` correctly afterwards: its already-v3 check requires
  // their absence, not just a version number.
  //
  // 0.2.101: a root rename commits the config and the transition registry as two
  // writes. If the process died between them, this replays the journal — finishing
  // the rename or undoing it entirely — BEFORE anything reads `roots[]`.
  recoverPendingRootRename(cwd);
  migrateConfigToV4(cwd);
  const { carried } = migrateConfigToV3(cwd);
  registry.carryDefaults(workspace.name, carried);
  const { created: configCreated, path: configFilePath, config } = loadOrCreateConfig(cwd);

  const rootRegistry = new RootRegistry(config.roots);
  ensureGitignore(cwd, { roots: rootRegistry.list(), gitEnabled: config.git.enabled });
  // 2.1.8 (M31 bootstrap): activation creates the directory of EVERY registry
  // root — the user roots (`kind: pages`) and the system roots, none of the
  // latter written to `config.json`. 2.1.9: which roots are system roots is the
  // registry's answer. The context build mkdirs again (idempotent) for roots
  // added later. `tags.json` stays lazy.
  let baseDir: string | null = null;
  for (const root of rootRegistry.list()) {
    if (root.kind === PAGES_KIND && root.builtin) baseDir = root.dir;
    fs.mkdirSync(path.resolve(cwd, root.dir), { recursive: true });
  }
  // M01 activation, the welcome-page step: only once onboarding has closed. A
  // fresh file says it has not (onboarding writes the page when it closes); a
  // file without the field — a project from before onboarding — reads as closed
  // and gets the page here. `ensureWelcomePage` leaves a non-empty space alone.
  if (config.onboardingCompleted && baseDir !== null) ensureWelcomePage(cwd, baseDir);

  return { config, configPath: configFilePath, configCreated };
}

/**
 * 2.1.58 (M01 `dsh8ezbz`, M31 `m31ctx001`): the activation of a REGISTERED
 * project — run by the context cache's build with writes, never before listen
 * (no project is an exception). Its failure (a home directory, a broken
 * `config.json`, EACCES) is that build's failure: the project answers
 * `500 PROJECT_BUILD_FAILED`, the process and every other project keep serving.
 * Step 7's legacy move: a database found in the project directory moves to the
 * workspace slot, it is not rebuilt. 2.1.60: this is the activation WITH writes
 * — the first request to a project whose background build ended in «needs
 * activation» runs it (the background build itself writes nothing,
 * {@link backgroundBuild}); a directory that does not exist is refused and not
 * created ({@link ProjectDirMissingError}).
 */
export function activateProject(
  registry: WorkspaceRegistry,
  workspace: WorkspaceRecord,
  project: ProjectRecord,
): ActivationResult {
  // 2.1.60 (step 1): a registered project's directory that no longer exists is
  // refused, not created.
  refuseNonProjectDir(project.cwd);
  const result = activateProjectDir(registry, workspace, project.cwd);
  migrateLegacyDbIfNeeded(registry, workspace, project.cwd, project.id);
  return result;
}

/**
 * The projects this process has activated — keyed by id AND directory, so a
 * project whose directory changed is activated again. One record per process,
 * shared by the registration route ({@link bootstrapProject}) and the cache's
 * build ({@link activatingBuild}): a project added through
 * `POST /api/workspace/projects` was activated there, so its first build only
 * builds.
 */
export class ActivatedProjects {
  private readonly keys = new Set<string>();
  private key(project: ProjectRecord): string {
    return `${project.id}\0${path.resolve(project.cwd)}`;
  }
  has(project: ProjectRecord): boolean {
    return this.keys.has(this.key(project));
  }
  add(project: ProjectRecord): void {
    this.keys.add(this.key(project));
  }
}

/**
 * 2.1.58 (M31 `m31ctx001`): the context cache's build WITH writes — the
 * activation, then the context. 2.1.60: the cache runs it for the first
 * request to a project whose background build ({@link backgroundBuild}) ended
 * in «needs activation»; an activation that throws (sync) rejects the build
 * like any build failure (the error state, retried after the failed-build
 * window). A project is activated once per process — a later build of its
 * context (after an invalidation) is a build, not a new activation — unless its
 * directory changed meanwhile. ASSUMPTION:dev-0202 — the rebuild after an
 * invalidation does not re-run the activation's file steps.
 * `activated` is the process's record, shared with {@link bootstrapProject}.
 */
export function activatingBuild<T>(
  registry: WorkspaceRegistry,
  workspace: WorkspaceRecord,
  build: (project: ProjectRecord, signal?: AbortSignal) => Promise<T>,
  activated: ActivatedProjects = new ActivatedProjects(),
): (project: ProjectRecord, signal?: AbortSignal) => Promise<T> {
  return async (project, signal) => {
    if (!activated.has(project)) {
      activateProject(registry, workspace, project);
      activated.add(project);
    }
    return build(project, signal);
  };
}

/**
 * M31: registration with activation — `POST /api/workspace/projects`. In a
 * workspace with a home the directory is checked against the home first
 * (M31 `m31boot01`: outside it → `PROJECT_PATH_OUTSIDE_HOME`, the home itself →
 * `PROJECT_PATH_IS_HOME`), so a refused path writes nothing at all; so is a
 * workspace whose stored entry is gone (`WorkspaceEntryGoneError`). The file
 * steps run BEFORE the registration, so a refused directory (a workspace home,
 * a broken config) is never registered, and the id is minted from the name the
 * config now carries. Idempotent end-to-end: re-activating an existing project
 * changes nothing. The project lands in `activated` (the record the cache's
 * build reads), so a build with writes does not activate it again; the route
 * then appends it to the background build queue.
 * (0.2.93: no integration artifact lands on disk; 0.1.104: external skills are
 * on-demand.)
 */
export function bootstrapProject(
  registry: WorkspaceRegistry,
  workspace: WorkspaceRecord,
  cwd: string,
  activated?: ActivatedProjects,
): BootstrapResult {
  if (workspace.home !== undefined) toProjectPath(workspace.home, cwd);
  // rev-0022: a view whose stored entry is gone (detached by another process of
  // this machine) is refused before the file steps touch the directory;
  // `registerProject` re-checks under the registry lock for a racing detach.
  registry.assertStoredEntry(workspace);
  const activation = activateProjectDir(registry, workspace, cwd);
  const project = registry.registerProject(workspace, cwd);
  migrateLegacyDbIfNeeded(registry, workspace, cwd, project.id);
  activated?.add(project);
  return { project, ...activation };
}

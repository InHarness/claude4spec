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
  writeConfig,
  type Config,
  type NormalizedConfig,
} from '../config.js';
import { toProjectPath, workspaceFilePath } from './home-workspace.js';
import { ensureGitignore } from '../../bin/gitignore.js';
import {
  BRIEFS,
  ENTITIES,
  multiRootViolation,
  readFileProjectType,
  resolveProjectType,
  type ResolvedProjectType,
} from '../project-types/resolve.js';
import type { ProjectTypeEntry } from '../project-types/registry.js';
import { legacyDbToMove, migrateLegacyDbIfNeeded } from './db-migration.js';
import { readRenameJournal, recoverPendingRootRename } from '../root-renames.js';
import { findProjectByCwd, type WorkspaceRegistry } from './registry.js';
import type { ProjectRecord, WorkspaceRecord } from './types.js';

/** What the activation's file steps (M01 `dsh8ezbz` steps 1–6) leave behind. */
export interface ActivationResult {
  config: NormalizedConfig;
  configPath: string;
  /** Did THIS activation write `config.json`? */
  configCreated: boolean;
  /** 2.1.77 (step 3): the settled type and the project's capability set. */
  type: ResolvedProjectType;
}

export interface BootstrapResult extends ActivationResult {
  project: ProjectRecord;
}

/** A dotted `config.json` key's value in the raw file object; `undefined` = no value. */
function rawKeyValue(raw: Record<string, unknown>, key: string): unknown {
  let cur: unknown = raw;
  for (const seg of key.split('.')) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur === null ? undefined : cur;
}

function readRawConfigObject(cwd: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')) as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * 2.1.77 (M01 `qi8w2tmj`, Wstawki): the one shared placeholder mechanism — every
 * `{key}` (a dotted `config.json` key) is replaced by that key's value in the
 * file after onboarding, verbatim, without formatting; a key without a value
 * stays literal so the author sees what to fill in.
 */
export function fillStarterPlaceholders(template: string, raw: Record<string, unknown>): string {
  return template.replace(/\{([A-Za-z][\w.-]*)\}/g, (whole, key: string) => {
    const value = rawKeyValue(raw, key);
    if (value === undefined) return whole;
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

/**
 * 2.1.77 (M01 `dsh8ezbz` step 6, `qi8w2tmj`): the starter content of the
 * project's type entry — the module holds no template and does not choose one
 * by type. Written into the base root's EFFECTIVE directory (the caller passes
 * it, found by the `builtin` flag), only when that space is empty and no file
 * is overwritten. After the page is written, each of the entry's keys that has
 * no value yet gets one pointing at the page (the page path relative to the
 * base root — ASSUMPTION:dev-0771, no key is declared yet), through the same
 * config write as every other. A type without starter content writes nothing.
 * Idempotent. The prompt block of the type description is not touched.
 */
export function writeStarterContent(cwd: string, baseDir: string, entry: ProjectTypeEntry): void {
  const starter = entry.starterContent;
  if (!starter) return;
  const basePath = path.join(cwd, baseDir);
  fs.mkdirSync(basePath, { recursive: true });
  const pagePath = path.join(basePath, starter.path);
  if (fs.existsSync(pagePath)) return;
  const existing = fs.readdirSync(basePath).filter((name) => !name.startsWith('.'));
  if (existing.length > 0) return;
  const raw = readRawConfigObject(cwd);
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(pagePath, fillStarterPlaceholders(starter.template, raw), 'utf8');
  const unset = starter.entryKeys.filter((k) => rawKeyValue(raw, k) === undefined);
  if (unset.length === 0) return;
  // `writeConfig` merges top-level keys: a nested key carries its whole branch.
  const partial: Record<string, unknown> = {};
  for (const key of unset) {
    const segs = key.split('.');
    const top = segs[0]!;
    if (segs.length === 1) {
      partial[top] = starter.path;
      continue;
    }
    const branch = (partial[top] ??= structuredClone(rawKeyValue(raw, top) ?? {})) as Record<string, unknown>;
    let cur = branch;
    for (const seg of segs.slice(1, -1)) {
      const next = cur[seg];
      cur = cur[seg] = next && typeof next === 'object' && !Array.isArray(next) ? (next as Record<string, unknown>) : {};
    }
    cur[segs[segs.length - 1]!] = starter.path;
  }
  writeConfig(cwd, partial as Partial<Config>);
}

/**
 * 2.1.77 (M01 `dsh8ezbz` step 3): the activation's type for a project
 * directory — from its file, else the input type, else `spec` — checked
 * against the registry and the copy in the workspace record. Throws
 * {@link ProjectTypeError} before anything is written.
 */
export function settleProjectType(cwd: string, inputType?: string, copyType?: string | null): ResolvedProjectType {
  return resolveProjectType({ fileType: readFileProjectType(cwd), inputType, copyType });
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
  // 2.1.77 (step 3): an unknown type, or one that disagrees with the copy in the
  // workspace record, ends the build in the error state with that cause.
  const type = settleProjectType(cwd, undefined, project.projectType ?? null);
  const { errors } = validateRootDirs(config.roots);
  if (errors.length > 0) throw new Error(errors[0]);
  const multiRoot = multiRootViolation(config.roots, type.capabilities);
  if (multiRoot) throw new Error(multiRoot);
  for (const root of new RootRegistry(config.roots).list()) {
    if (root.kind === 'entities' && !type.capabilities.has(ENTITIES)) continue;
    // 2.1.77 (M21 `dcagtfpe`, M23 `iifnvhtu`): without `briefs` no brief or patch root.
    if ((root.kind === 'briefs' || root.kind === 'patches') && !type.capabilities.has(BRIEFS)) continue;
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
export interface ActivationInputs {
  /** The type given from outside — the new-project path or `PROJECT_TYPE`; absent = none. */
  inputType?: string;
  /** The copy in the workspace record (`null` = record without the field); `undefined` = no record yet. */
  copyType?: string | null;
}

export function activateProjectDir(
  registry: WorkspaceRegistry,
  workspace: WorkspaceRecord,
  cwd: string,
  inputs: ActivationInputs = {},
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
  //
  // 2.1.77 (step 3, rev-0002): the type is settled FIRST, before the rename
  // recovery, the migrations and the registry's `carryDefaults` write — a
  // refusal (`PROJECT_TYPE_CONFLICT` / `_UNKNOWN` / `_MISMATCH`) leaves the
  // directory and the registry as they were. `projectType` is a raw key none of
  // those steps rewrites, so reading it before them gives the same answer.
  const type = settleProjectType(cwd, inputs.inputType, inputs.copyType);
  recoverPendingRootRename(cwd);
  migrateConfigToV4(cwd);
  const { carried } = migrateConfigToV3(cwd);
  registry.carryDefaults(workspace.name, carried);
  const { created: configCreated, path: configFilePath, config } = loadOrCreateConfig(cwd, type.entry.slug);
  // M01 `kt5gesnm`: without `multi-root`, `roots[]` carries only the base root.
  const multiRoot = multiRootViolation(config.roots, type.capabilities);
  if (multiRoot) throw new Error(multiRoot);

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
    // 2.1.77 (M01 `hbib9dy0`, step 8): a project without `entities` gets no entity store.
    if (root.kind === 'entities' && !type.capabilities.has(ENTITIES)) continue;
    // 2.1.77 (M21 `dcagtfpe`, M23 `iifnvhtu`): without `briefs` no brief or patch root.
    if ((root.kind === 'briefs' || root.kind === 'patches') && !type.capabilities.has(BRIEFS)) continue;
    fs.mkdirSync(path.resolve(cwd, root.dir), { recursive: true });
  }
  // M01 activation, step 6: the type entry's starter content, only once
  // onboarding has closed. A fresh file says it has not (onboarding writes the
  // page when it closes); a file without the field — a project from before
  // onboarding — reads as closed and gets the page here. A non-empty space is left alone.
  if (config.onboardingCompleted && baseDir !== null) writeStarterContent(cwd, baseDir, type.entry);

  return { config, configPath: configFilePath, configCreated, type };
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
  // The record exists: its copy of the type (absent = `spec`) is the witness.
  const result = activateProjectDir(registry, workspace, project.cwd, { copyType: project.projectType ?? null });
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
/**
 * 2.1.77 (M31 `m31boot01`): a directory that does not fit the registration
 * path — `config.json` on the new-project path (`PROJECT_PATH_ALREADY_INITIALIZED`),
 * none on the existing-directory path (`PROJECT_PATH_NOT_INITIALIZED`). Refused
 * before anything is written; the page sends the user to the other path.
 */
export class ProjectPathModeError extends Error {
  constructor(
    readonly code: 'PROJECT_PATH_ALREADY_INITIALIZED' | 'PROJECT_PATH_NOT_INITIALIZED',
    readonly dir: string,
  ) {
    super(
      code === 'PROJECT_PATH_ALREADY_INITIALIZED'
        ? `${dir} already holds a project (.claude4spec/config.json) — add it as an existing directory`
        : `${dir} holds no project (.claude4spec/config.json is missing) — create it as a new project`,
    );
    this.name = 'ProjectPathModeError';
  }
}

export function bootstrapProject(
  registry: WorkspaceRegistry,
  workspace: WorkspaceRecord,
  cwd: string,
  activated?: ActivatedProjects,
  /** 2.1.77 (M31 `bzgfftsf`): the type given from outside — the new-project path; absent = read from `config.json`. */
  projectType?: string,
): BootstrapResult {
  if (workspace.home !== undefined) toProjectPath(workspace.home, cwd);
  // rev-0022: a view whose stored entry is gone (detached by another process of
  // this machine) is refused before the file steps touch the directory;
  // `registerProject` re-checks under the registry lock for a racing detach.
  registry.assertStoredEntry(workspace);
  if (fs.existsSync(workspaceFilePath(cwd))) throw new WorkspaceHomeNotProjectError(cwd);
  // 2.1.77 (M31 `m31boot01`, `bzgfftsf`): the path is told by the presence of a
  // type; a directory that does not fit it — or an unknown type, or a type that
  // conflicts with the file (`settleProjectType` below) — is refused before any write.
  const hasConfig = fs.existsSync(configPath(cwd));
  if (projectType !== undefined && hasConfig) throw new ProjectPathModeError('PROJECT_PATH_ALREADY_INITIALIZED', cwd);
  if (projectType === undefined && !hasConfig) throw new ProjectPathModeError('PROJECT_PATH_NOT_INITIALIZED', cwd);
  const known = findProjectByCwd(workspace.projects, cwd);
  const activation = activateProjectDir(registry, workspace, cwd, {
    inputType: projectType,
    copyType: known ? (known.projectType ?? null) : undefined,
  });
  // The settled type goes to the record as its copy (M31 `t97gncju`).
  const project = registry.registerProject(workspace, cwd, activation.type.entry.slug);
  migrateLegacyDbIfNeeded(registry, workspace, cwd, project.id);
  activated?.add(project);
  return { project, ...activation };
}

import fs from 'node:fs';
import path from 'node:path';
import type { GitPublishResult, GitUpstreamPathResult } from '../../shared/git.js';
import type { GitRepoRoot } from '../services/git.js';
import type { RunnerHostStatus } from '../../shared/runner-hosts.js';
import type { RemoteRunRegistry } from './remote-run-registry.js';
import { newRunId } from './run-id.js';
import type { C4sTrust, RunInput, RunRequest } from './run-request.js';
import { sameProjectPath } from '../workspace/home-workspace.js';
import type { HomeProjectTrust } from '../workspace/types.js';
import { mapRunnerApiCode, putRunOverHttp, type PutRun } from './runner-runs-client.js';
import { DEFAULT_RUN_AGENT_NAME, RUN_AGENT_DEFINITIONS, type RunAgentDefinition } from './plan-execution-agent.js';

/**
 * M55 — `run_remote` (spec-operation `run-remote`): dispatch a Run to a runner
 * host and return before it finishes. The steps are `55a63udm`'s:
 *
 *  1. host selection (`hcdxxeja`);
 *  2. publication of the plan with M28 `publishFile` when it is not pushed
 *     (none for a prompt);
 *  3. the path on the upstream with M28 `checkPathOnUpstream` — the base sha
 *     and the cleared remote (the plan's path, or `<home>/.claude4spec/workspace.json`
 *     for a prompt);
 *  4. the `projectId` of the order (`ffb3rhrs`): the parameter, else the
 *     thread's project; an id outside the workspace is `RUN_PROJECT_NOT_FOUND`,
 *     another project with the plan pinned to the thread is `INVALID_ARGS`;
 *     the plan's path stays as the thread holds it — relative to the plans
 *     directory of the project — and is not recomputed;
 *  5. the version check of the agent definition against the environment
 *     recipe (`kcxoa7qg`);
 *  6. the trust in the order (`jlgucjnq`): the local consent of the Run's
 *     project alone — plugin trust and confirmed skill attachments — sent
 *     only when the path it was given for equals the project's path in
 *     `workspace.json` at the base sha; otherwise nothing about trust is sent
 *     and the answer carries `warnings`;
 *  7. the registry INSERT (runId → hostId only: the trust is not stored);
 *  8. `PUT /runs/{runId}`, with the trust of step 6;
 *  9. `{ runId, host, warnings? }`.
 *
 * The conditions (`e9ce6072`) are checked before any of them. A refusal before
 * the `PUT` leaves no registry row. A host's `4xx` refusal deletes the row; a
 * network error at the `PUT` keeps it and answers `unconfirmed: true` — never
 * retried here. Every call mints a new runId.
 */

/** The codes of the `run-remote` record (`kodyBledow`). */
export type RunRemoteErrorCode =
  | 'GIT_UNAVAILABLE'
  | 'RUN_WORKSPACE_WITHOUT_HOME'
  | 'RUN_PROJECT_OUTSIDE_HOME'
  | 'RUN_PROJECT_NOT_FOUND'
  | 'RUN_NO_HOST'
  | 'RUN_HOST_REQUIRED'
  | 'RUN_HOST_NOT_FOUND'
  | 'RUN_HOST_NOT_CONNECTED'
  | 'RUN_HOST_WITHOUT_RUNS'
  | 'RUN_AGENT_NOT_FOUND'
  | 'RUN_C4S_VERSION_INCOMPATIBLE'
  | 'INVALID_ARGS'
  | 'PLAN_NOT_FOUND'
  | 'RUN_NO_UPSTREAM'
  | 'RUN_PLAN_NOT_ON_UPSTREAM'
  | 'RUN_PUBLISH_FAILED'
  | 'RUN_GIT_BUSY'
  | 'RUN_REJECTED'
  | 'RUN_HOST_UNAUTHENTICATED'
  | 'RUN_HOST_ERROR'
  | 'RUN_HOST_UNREACHABLE'
  | 'RUN_INTERNAL';

export const RUN_REMOTE_ERROR_CODES: readonly RunRemoteErrorCode[] = [
  'GIT_UNAVAILABLE',
  'RUN_WORKSPACE_WITHOUT_HOME',
  'RUN_PROJECT_OUTSIDE_HOME',
  'RUN_PROJECT_NOT_FOUND',
  'RUN_NO_HOST',
  'RUN_HOST_REQUIRED',
  'RUN_HOST_NOT_FOUND',
  'RUN_HOST_NOT_CONNECTED',
  'RUN_HOST_WITHOUT_RUNS',
  'RUN_AGENT_NOT_FOUND',
  'RUN_C4S_VERSION_INCOMPATIBLE',
  'INVALID_ARGS',
  'PLAN_NOT_FOUND',
  'RUN_NO_UPSTREAM',
  'RUN_PLAN_NOT_ON_UPSTREAM',
  'RUN_PUBLISH_FAILED',
  'RUN_GIT_BUSY',
  'RUN_REJECTED',
  'RUN_HOST_UNAUTHENTICATED',
  'RUN_HOST_ERROR',
  'RUN_HOST_UNREACHABLE',
  'RUN_INTERNAL',
];

/** A refusal of `run_remote`. `extra` carries the remedy: the host list, the refused field. */
export class RunRemoteError extends Error {
  constructor(
    readonly code: RunRemoteErrorCode,
    message: string,
    readonly hint?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RunRemoteError';
  }
}

/** A host as `run_remote` sees it: the M54 in-process read plus the name it is shown under. */
export interface RunRemoteHost {
  id: string;
  name: string | null;
  url: string;
  token: string | null;
  status: RunnerHostStatus;
  hostId: string | null;
  capabilities: string[];
}

/** The M28 primitives the operation composes, over the thread's project repository. */
export interface RunRemoteGit {
  /** `config.git.enabled` and a detected repository, else `null` (`GitService.probeRepo`). */
  probeRepo(): Promise<GitRepoRoot | null>;
  workspaceHomePath(home: string): Promise<string | null>;
  checkPathOnUpstream(relPath: string): Promise<GitUpstreamPathResult>;
  publishFile(relPath: string, opts?: { threadId?: string | null }): Promise<GitPublishResult>;
  showFile(sha: string, absPath: string, precomputed?: GitRepoRoot): Promise<string | null>;
}

export interface RunRemotePlans {
  /** Absolute directory of the `plans` root. */
  rootDir: string;
  /** The plan pinned to a thread (`null` for none). */
  pinnedPlanPath(threadId: string): Promise<string | null> | string | null;
  exists(planPath: string): Promise<boolean>;
}

/**
 * The machine-local consent of one project (M31 `44viw74p`), as the registry
 * stores it: the path it was given for (relative to the workspace home), the
 * plugin trust and the confirmed skill-attachment names (M52 `ybbal0vf`).
 */
export interface RunLocalConsent {
  path: string;
  trustProjectPlugins?: boolean;
  confirmedSkillUses?: string[];
}

/** What the project's committed code asks a consent for: local plugin packages and `skill.uses` names. */
export interface RunConsentNeeds {
  plugins: boolean;
  skillUses: string[];
}

export interface RunRemoteDeps {
  /** The workspace of this process, read per call. */
  workspace(): { name: string; home?: string };
  /** The thread's project. */
  projectId: string;
  /**
   * The projects of the workspace (its `workspace.json` records, M31
   * `fzno8pd4`), each with the absolute directory of its plans
   * (`<project path>/.claude4spec/plans/`); read per call.
   */
  projects(): Array<{ id: string; plansRoot: string }>;
  git: RunRemoteGit;
  plans: RunRemotePlans;
  /** Every runner host of the workspace (M54 `43dazlrg`), read per call. */
  hosts(): RunRemoteHost[];
  /** The Runs registry; opened only once a row is written (a registry workspace has no workspace DB). */
  registry(): RemoteRunRegistry;
  /**
   * The stored local consent of a project with its path (M31, the registry
   * entry's `projectTrust[id]`), read raw — NOT folded by the view, so a
   * consent given for another path is seen as such. `null` = none. Omitted =
   * no consent on this machine.
   */
  localConsent?(projectId: string): RunLocalConsent | null;
  /** What the project asks a consent for. Omitted = nothing. */
  consentNeeds?(projectId: string): RunConsentNeeds;
  putRun?: PutRun;
  newRunId?: () => string;
  agents?: Readonly<Record<string, RunAgentDefinition>>;
}

export interface RunRemoteInput {
  planPath?: string;
  prompt?: string;
  projectId?: string;
  agent?: string;
  host?: string;
  notes?: string;
  timeoutMinutes?: number;
  model?: string;
  /** The calling thread — the address of the pinned plan. */
  threadId?: string | null;
}

export interface RunRemoteResult {
  runId: string;
  host: { id: string; name: string | null };
  /** Only when the order may not have reached the host (network error at the `PUT`). */
  unconfirmed?: true;
  /**
   * Only when not empty (`jlgucjnq`): the trust the order did not carry — the
   * project's plugins or skill uses without a local consent for this path, or
   * a consent given for another path. The thread's agent relays them in chat.
   */
  warnings?: string[];
}

/** `workspace.json` of the home, relative to the home. */
const WORKSPACE_DESCRIPTION = '.claude4spec/workspace.json';

/** `c4s-runner` `modules/M05-workspace-environment.md` #fovr3uty: the recipe, relative to the workspace home. */
export const ENVIRONMENT_RECIPE_PATH = '.c4s-runner/environment.json';
/** The recipe `schemaVersion` this master knows (#bx9zc0kp). */
export const KNOWN_RECIPE_SCHEMA_VERSION = 1;
/** The capability value of the runner's Runs API. */
export const RUNS_CAPABILITY = 'runs';

const fail = (code: RunRemoteErrorCode, message: string, hint?: string, extra?: Record<string, unknown>): never => {
  throw new RunRemoteError(code, message, hint, extra);
};

const joinRel = (base: string, rel: string): string => (base === '.' ? rel : path.posix.join(base, rel));

function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** `p` relative to `root` in posix form, or `null` when it lies outside. */
function relativeInside(root: string, p: string): string | null {
  const rel = path.relative(root, p);
  if (rel === '') return '.';
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) return null;
  return rel.split(path.sep).join('/');
}

function hostList(hosts: RunRemoteHost[]): Array<{ id: string; name: string | null }> {
  return hosts.map((h) => ({ id: h.id, name: h.name }));
}

/** `hcdxxeja`. */
function selectHost(hosts: RunRemoteHost[], requested: string | undefined): RunRemoteHost {
  const offersRuns = (h: RunRemoteHost) => h.capabilities.includes(RUNS_CAPABILITY);
  if (requested !== undefined) {
    const host = hosts.find((h) => h.id === requested);
    if (!host) return fail('RUN_HOST_NOT_FOUND', `runner host '${requested}' does not exist`, undefined, { hosts: hostList(hosts) });
    if (host.status !== 'connected' || host.hostId === null || host.token === null) {
      return fail('RUN_HOST_NOT_CONNECTED', `runner host '${requested}' is not connected (status: ${host.status})`);
    }
    if (!offersRuns(host)) return fail('RUN_HOST_WITHOUT_RUNS', `runner host '${requested}' does not offer Runs`);
    return host;
  }
  const candidates = hosts.filter((h) => h.status === 'connected' && h.hostId !== null && h.token !== null && offersRuns(h));
  if (candidates.length === 0) return fail('RUN_NO_HOST', 'no connected runner host offers Runs');
  if (candidates.length > 1) {
    return fail(
      'RUN_HOST_REQUIRED',
      'several connected runner hosts offer Runs — pass `host`',
      'choose one of `hosts` and pass its `id` as `host`',
      { hosts: hostList(candidates) },
    );
  }
  return candidates[0]!;
}

function upstreamRefusal(result: Exclude<GitUpstreamPathResult, { status: 'on-upstream' }>, what: string): never {
  switch (result.status) {
    case 'skipped':
      return fail('GIT_UNAVAILABLE', 'git is disabled, there is no repository, or HEAD is not on a branch');
    case 'no-upstream':
      return fail('RUN_NO_UPSTREAM', 'the current branch has no upstream');
    case 'busy':
      return fail('RUN_GIT_BUSY', 'the repository is busy — try again');
    case 'path-dirty':
    case 'path-differs':
      // ASSUMPTION:dev-0005 — the prompt input's workspace description not on the
      // upstream is refused with the same code as the plan.
      return fail('RUN_PLAN_NOT_ON_UPSTREAM', `${what} differs between HEAD (or the working tree) and the upstream`);
    case 'error':
      // ASSUMPTION:dev-0006 — a failed check (the fetch of the upstream's remote,
      // a git failure) is RUN_INTERNAL: the record names no code of its own for it.
      return fail('RUN_INTERNAL', `checking ${what} on the upstream failed: ${result.message}`);
  }
}

function publishRefusal(result: GitPublishResult): void {
  switch (result.status) {
    case 'published':
    case 'nothing-to-publish':
      return;
    case 'skipped':
      return fail('GIT_UNAVAILABLE', 'git is disabled, there is no repository, or HEAD is not on a branch');
    case 'no-upstream':
      return fail('RUN_NO_UPSTREAM', 'the current branch has no upstream');
    case 'busy':
      return fail('RUN_GIT_BUSY', 'the repository is busy — try again');
    case 'error':
      return fail('RUN_PUBLISH_FAILED', `publishing the plan failed: ${result.message}`, result.recovery.reason);
  }
}

const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Semver precedence of two exact versions (negative: `a` lower); `null` when either is not an exact version. */
export function compareVersions(a: string, b: string): number | null {
  const ma = EXACT_VERSION.exec(a);
  const mb = EXACT_VERSION.exec(b);
  if (!ma || !mb) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i]);
    if (d !== 0) return d;
  }
  const pa = ma[4];
  const pb = mb[4];
  if (pa === undefined || pb === undefined) return pa === pb ? 0 : pa === undefined ? 1 : -1;
  const ia = pa.split('.');
  const ib = pb.split('.');
  for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
    const x = ia[i];
    const y = ib[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** `kcxoa7qg`: only a known `schemaVersion` with a readable lower `c4sVersion` refuses. */
function checkRecipeVersion(recipeText: string | null, agent: RunAgentDefinition): void {
  if (recipeText === null) return;
  let recipe: unknown;
  try {
    recipe = JSON.parse(recipeText);
  } catch {
    return;
  }
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return;
  const { schemaVersion, c4sVersion } = recipe as Record<string, unknown>;
  if (schemaVersion !== KNOWN_RECIPE_SCHEMA_VERSION) return;
  // An unreadable version is no refusal either.
  if (typeof c4sVersion !== 'string') return;
  const order = compareVersions(c4sVersion, agent.minC4sVersion);
  if (order !== null && order < 0) {
    fail(
      'RUN_C4S_VERSION_INCOMPATIBLE',
      `the environment recipe pins c4s ${c4sVersion}, lower than ${agent.minC4sVersion} required by agent '${agent.name}' ${agent.version}`,
      `raise \`c4sVersion\` in ${ENVIRONMENT_RECIPE_PATH} to at least ${agent.minC4sVersion}`,
    );
  }
}

/** The project's path in a `workspace.json` text, or `null` (unreadable, off the shape, not listed). */
function projectPathIn(workspaceText: string | null, projectId: string): string | null {
  if (workspaceText === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(workspaceText);
  } catch {
    return null;
  }
  const projects = (parsed as { projects?: unknown } | null)?.projects;
  if (!Array.isArray(projects)) return null;
  const entry = projects.find(
    (p): p is { id: string; path: string } =>
      !!p && typeof p === 'object' && (p as { id?: unknown }).id === projectId && typeof (p as { path?: unknown }).path === 'string',
  );
  return entry ? entry.path : null;
}

/** Warnings of `run_remote` (mcp-tool `run-tools-run-remote`, `returns`). */
export const TRUST_WARNING_PLUGINS = 'trust not sent: project plugins without local approval for this path';
export const TRUST_WARNING_SKILL_USES = 'trust not sent: skill uses without local approval for this path';
export const trustPathMismatchWarning = (projectId: string, consentPath: string, basePath: string | null): string =>
  `trust not sent: the local approval of project '${projectId}' is for path '${consentPath}', ` +
  (basePath === null
    ? `and the project is not in ${WORKSPACE_DESCRIPTION} at the base sha`
    : `not '${basePath}' as in ${WORKSPACE_DESCRIPTION} at the base sha`) +
  ' — approve the current path on this machine and order a new Run';

/**
 * Step 6 (`jlgucjnq`): the `c4sTrust` of the order and the warnings. Only the
 * Run's project; only its local consent (the plugin trust when granted, the
 * confirmed skill-attachment names); only when the consent's path equals the
 * project's path in `workspace.json` at the base sha. A missing consent or one
 * for another path never refuses: nothing is sent and a warning says why.
 *
 * ASSUMPTION:dev-6702 — what the project asks a consent for (local plugin
 * packages, `skill.uses`) is read from the project's directory on this
 * machine, not from the base sha; on a path mismatch the mismatch warning
 * stands alone.
 */
function trustOf(
  projectId: string,
  consent: RunLocalConsent | null,
  needs: RunConsentNeeds,
  basePath: string | null,
): { c4sTrust?: C4sTrust; warnings: string[] } {
  const warnings: string[] = [];
  const grantsAnything =
    consent !== null && (consent.trustProjectPlugins === true || (consent.confirmedSkillUses ?? []).length > 0);
  const samePath = consent !== null && basePath !== null && sameProjectPath(consent.path, basePath);
  const plugins = samePath && consent!.trustProjectPlugins === true;
  const attachments = samePath ? [...new Set(consent!.confirmedSkillUses ?? [])] : [];
  if (grantsAnything && !samePath) {
    // One cause, one warning: the approval exists, for another path — the
    // "without local approval" warnings below would misstate that.
    warnings.push(trustPathMismatchWarning(projectId, consent!.path, basePath));
  } else {
    if (needs.plugins && !plugins) warnings.push(TRUST_WARNING_PLUGINS);
    const unconfirmed = needs.skillUses.filter((n) => !attachments.includes(n));
    if (unconfirmed.length > 0) warnings.push(`${TRUST_WARNING_SKILL_USES}: ${unconfirmed.join(', ')}`);
  }
  if (!plugins && attachments.length === 0) return { warnings };
  return {
    c4sTrust: {
      projects: {
        [projectId]: {
          path: consent!.path,
          ...(plugins ? { trustProjectPlugins: true } : {}),
          ...(attachments.length > 0 ? { skillAttachments: attachments } : {}),
        },
      },
    },
    warnings,
  };
}

export async function runRemote(deps: RunRemoteDeps, input: RunRemoteInput): Promise<RunRemoteResult> {
  // Addressing (mcp-tool `run-tools-run-remote` logic).
  if (input.planPath !== undefined && input.prompt !== undefined) {
    fail('INVALID_ARGS', '`planPath` and `prompt` are mutually exclusive');
  }
  if (input.prompt !== undefined && input.prompt.trim() === '') fail('INVALID_ARGS', '`prompt` must not be empty');
  const agentName = input.agent ?? DEFAULT_RUN_AGENT_NAME;
  const agents = deps.agents ?? RUN_AGENT_DEFINITIONS;
  // Own keys only: `constructor`, `toString`, `__proto__` are no agent definitions.
  const agent = Object.hasOwn(agents, agentName) ? agents[agentName] : undefined;
  if (!agent) fail('RUN_AGENT_NOT_FOUND', `no agent definition named '${agentName}'`, `known: ${Object.keys(agents).join(', ')}`);

  // Conditions (`e9ce6072`).
  const repo = await deps.git.probeRepo();
  if (!repo) fail('GIT_UNAVAILABLE', 'git is disabled or the project is not in a repository');
  const workspace = deps.workspace();
  if (workspace.home === undefined) {
    fail('RUN_WORKSPACE_WITHOUT_HOME', `workspace '${workspace.name}' has no home directory — a registry workspace cannot dispatch Runs`);
  }
  const home = await deps.git.workspaceHomePath(workspace.home!);
  if (home === null) fail('RUN_PROJECT_OUTSIDE_HOME', 'the project and the workspace home are not in one repository');
  const rootPath = repo!.rootPath;
  if (!rootPath) return fail('GIT_UNAVAILABLE', 'the project is not in a repository');

  // The input, resolved before anything leaves the machine. Step 4 (`55a63udm`,
  // `ffb3rhrs`) — the order's `projectId` — is decided here, because the plan
  // named explicitly is looked up in the plans directory of that project, and
  // its file is what steps 2–3 publish and check (ASSUMPTION:dev-5501).
  const projectId = input.projectId ?? deps.projectId;
  const project = deps.projects().find((p) => p.id === projectId);
  if (!project) {
    fail(
      'RUN_PROJECT_NOT_FOUND',
      `project '${projectId}' is not in workspace '${workspace.name}'`,
      'pass the `id` of a project of the workspace as `projectId`, or omit it for the current project',
    );
  }
  let planPath: string | null = null;
  let planRepoPath: string | null = null;
  if (input.prompt === undefined) {
    const pinned = input.planPath === undefined;
    if (pinned && projectId !== deps.projectId) {
      fail('INVALID_ARGS', `the plan attached to this thread belongs to project '${deps.projectId}', not '${projectId}' — omit \`projectId\` or pass \`planPath\``);
    }
    planPath = input.planPath ?? (input.threadId ? await deps.plans.pinnedPlanPath(input.threadId) : null);
    if (planPath === null) fail('INVALID_ARGS', 'no plan is attached to this thread — pass `planPath` or `prompt`');
    const own = projectId === deps.projectId;
    const plansDir = own ? deps.plans.rootDir : project!.plansRoot;
    const planAbs = path.join(plansDir, planPath!);
    const found = own
      ? await deps.plans.exists(planPath!)
      : // Realpaths on both sides, as PlanService does for the own project: a
        // symlink inside the plans directory that points outside it is refused.
        relativeInside(realpathOrSelf(plansDir), realpathOrSelf(planAbs)) !== null &&
        fs.existsSync(planAbs) &&
        fs.statSync(planAbs).isFile();
    if (!found) fail('PLAN_NOT_FOUND', `plan '${planPath}' not found in project '${projectId}'`);
    planRepoPath = relativeInside(realpathOrSelf(rootPath), realpathOrSelf(planAbs));
    if (planRepoPath === null) fail('RUN_PROJECT_OUTSIDE_HOME', 'the plan is not in the repository of the workspace home');
  }

  // 1. Host.
  const host = selectHost(deps.hosts(), input.host);

  // 2–3. Publication (plan only) and the path on the upstream.
  let upstream: GitUpstreamPathResult;
  if (planRepoPath !== null) {
    upstream = await deps.git.checkPathOnUpstream(planRepoPath);
    if (upstream.status === 'path-dirty' || upstream.status === 'path-differs') {
      publishRefusal(await deps.git.publishFile(planRepoPath, { threadId: input.threadId ?? null }));
      upstream = await deps.git.checkPathOnUpstream(planRepoPath);
    }
    if (upstream.status !== 'on-upstream') upstreamRefusal(upstream, `plan file '${planRepoPath}'`);
  } else {
    const description = joinRel(home!, WORKSPACE_DESCRIPTION);
    upstream = await deps.git.checkPathOnUpstream(description);
    if (upstream.status !== 'on-upstream') upstreamRefusal(upstream, `workspace description '${description}'`);
  }
  const onUpstream = upstream as Extract<GitUpstreamPathResult, { status: 'on-upstream' }>;

  // 4. The input: always the project; a plan's path as the thread holds it,
  // relative to the plans directory of that project — the master recomputes nothing.
  const runInput: RunInput =
    planPath !== null
      ? { kind: 'plan', projectId, path: planPath }
      : { kind: 'prompt', projectId, text: input.prompt! };

  // 5. The definition's version against the recipe at the base sha.
  // The workspace home's directory, once, for both reads at the base sha (steps 5 and 6).
  const homeAbs = path.join(rootPath, home === '.' ? '' : home!);
  const recipeAbs = path.join(homeAbs, ENVIRONMENT_RECIPE_PATH);
  checkRecipeVersion(await deps.git.showFile(onUpstream.tipSha, recipeAbs, repo!), agent!);

  // 6. The trust in the order: the Run's project alone, its local consent, the path at the base sha.
  const consent = deps.localConsent?.(projectId) ?? null;
  const needs = deps.consentNeeds?.(projectId) ?? { plugins: false, skillUses: [] };
  const basePath =
    consent !== null
      ? projectPathIn(await deps.git.showFile(onUpstream.tipSha, path.join(homeAbs, WORKSPACE_DESCRIPTION), repo!), projectId)
      : null;
  const trust = trustOf(projectId, consent, needs, basePath);

  const body: RunRequest = {
    repo: onUpstream.remote,
    home: home!,
    baseSha: onUpstream.tipSha,
    agent: { name: agent!.name, version: agent!.version, content: agent!.content },
    input: runInput,
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    // `arzrwkiq`: no parameter → no field (the host's default applies); a given value passes unchanged.
    ...(input.timeoutMinutes !== undefined ? { timeoutMinutes: input.timeoutMinutes } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(trust.c4sTrust !== undefined ? { c4sTrust: trust.c4sTrust } : {}),
  };

  // 7. Registry — runId → hostId only; the trust stays out of it (`jlgucjnq`).
  const runId = (deps.newRunId ?? newRunId)();
  const registry = deps.registry();
  registry.insert(runId, host.hostId!);
  const result: RunRemoteResult = {
    runId,
    host: { id: host.id, name: host.name },
    ...(trust.warnings.length > 0 ? { warnings: trust.warnings } : {}),
  };

  // 8. PUT — once; this operation never retries it.
  const outcome = await (deps.putRun ?? putRunOverHttp)({ url: host.url, token: host.token! }, runId, body);
  if (outcome.kind === 'accepted') return result;
  if (outcome.kind === 'network') return { ...result, unconfirmed: true };

  const { status, error } = outcome;
  if (status >= 400 && status < 500) registry.delete(runId);
  const message = error.message ?? `runner host answered HTTP ${status}${error.code ? ` ${error.code}` : ''}`;
  if (error.code === 'invalid_request') {
    return fail('RUN_REJECTED', message, undefined, error.field !== null ? { field: error.field } : undefined);
  }
  if (error.code === 'conflict') {
    // A fresh runId never names a known Run, so this is the master's own fault; never retried with this runId.
    return fail('RUN_INTERNAL', `runner host reports a conflict for the new runId ${runId}: ${message}`);
  }
  return fail(mapRunnerApiCode(error.code), message);
}

/**
 * The M54 in-process read of every host (`43dazlrg`), with the name each is
 * shown under (its label, else the host's own name from the binding). Sends
 * nothing to any host.
 */
export function runHostsFromSupervisor(supervisor: {
  readHosts(): Array<Omit<RunRemoteHost, 'name'>>;
  list(): Array<{ record: { id: string; label?: string; binding: { hostName: string } | null } }>;
}): RunRemoteHost[] {
  const names = new Map(supervisor.list().map(({ record }) => [record.id, record.label ?? record.binding?.hostName ?? null]));
  return supervisor.readHosts().map((h) => ({ ...h, name: names.get(h.id) ?? null }));
}

/** The plan side of `run_remote` over M10's `PlanService`. */
export function runPlansFromService(plans: {
  rootDir: string;
  getByThread(threadId: string): Promise<{ path: string } | null>;
  assertAddressedPlan(planPath: string): Promise<void>;
}): RunRemotePlans {
  return {
    rootDir: plans.rootDir,
    pinnedPlanPath: async (threadId) => (await plans.getByThread(threadId))?.path ?? null,
    exists: async (planPath) => {
      try {
        await plans.assertAddressedPlan(planPath);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * The local consent of one project as `run_remote` reads it (M31 `44viw74p`):
 * the registry entry's `projectTrust[id]` as stored — with the path it was
 * given for, never folded by the view. `null` = no consent on this machine.
 */
export function runLocalConsentOf(projectTrust: Record<string, HomeProjectTrust> | undefined, projectId: string): RunLocalConsent | null {
  const t = projectTrust && Object.hasOwn(projectTrust, projectId) ? projectTrust[projectId] : undefined;
  if (!t || typeof t.path !== 'string') return null;
  return {
    path: t.path,
    ...(t.trustProjectPlugins !== undefined ? { trustProjectPlugins: t.trustProjectPlugins } : {}),
    ...(t.confirmedSkillUses !== undefined ? { confirmedSkillUses: [...t.confirmedSkillUses] } : {}),
  };
}

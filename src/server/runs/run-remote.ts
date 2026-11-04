import fs from 'node:fs';
import path from 'node:path';
import type { GitPublishResult, GitUpstreamPathResult } from '../../shared/git.js';
import type { GitRepoRoot } from '../services/git.js';
import type { RunnerHostStatus } from '../../shared/runner-hosts.js';
import type { RemoteRunRegistry } from './remote-run-registry.js';
import { newRunId } from './run-id.js';
import type { C4sTrust, RunContinuation, RunInput, RunRequest } from './run-request.js';
import { RUN_ID_PATTERN } from './run-id.js';
import { readRunRecordAt, runRecordPath } from './run-read.js';
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
 *  7. the registry INSERT (runId → hostId, and `parent_run_id` — null for a
 *     fresh Run, the parent's runId for a continuation; the trust is not stored);
 *  8. `PUT /runs/{runId}`, with the trust of step 6;
 *  9. `{ runId, host, warnings? }`.
 *
 * The conditions (`e9ce6072`) are checked before any of them. A refusal before
 * the `PUT` leaves no registry row. A host's `4xx` refusal deletes the row; a
 * network error at the `PUT` keeps it and answers `unconfirmed: true` — never
 * retried here. Every call mints a new runId. All of this holds for a fresh
 * order and for a continuation alike.
 *
 * 2.1.68 — a continuation (`fromRunId`, `fdu51xri`) runs its own order of
 * steps: `fetch()`; recognition of the parent (`RUN_PARENT_*`, before any
 * registry row); the base sha = the tip of the local `refs/runs/<parent>/work`;
 * the host — the parent's by default, any explicit one allowed, each needing
 * `run-continuation` (`hcdxxeja`); no publication and no path check on the
 * upstream — the plan is read at the base sha; the project and the plan's path
 * from the parent's record; the version check and the trust at the base sha;
 * the registry row with the parent's runId; the `PUT` with `continuation`.
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
  | 'RUN_HOST_WITHOUT_CONTINUATION'
  | 'RUN_PARENT_NOT_FOUND'
  | 'RUN_PARENT_WITHOUT_RESULT'
  | 'RUN_PARENT_PROMPT_INPUT'
  | 'RUN_PARENT_RECIPE_MODIFIED'
  | 'RUN_PARENT_SUPERSEDED'
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
  'RUN_HOST_WITHOUT_CONTINUATION',
  'RUN_PARENT_NOT_FOUND',
  'RUN_PARENT_WITHOUT_RESULT',
  'RUN_PARENT_PROMPT_INPUT',
  'RUN_PARENT_RECIPE_MODIFIED',
  'RUN_PARENT_SUPERSEDED',
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
  /** 2.1.68 (`fdu51xri` step 1): M28 `fetch()` — the upstream and the shadow namespace. */
  fetch(): Promise<{ status: string }>;
  /** 2.1.68: the tip of the local `refs/runs/<id>`, `null` without the ref. */
  shadowTip(id: string, precomputed?: GitRepoRoot): Promise<string | null>;
  /** 2.1.68: M28 `resolveShadow` — with `supersession: true`, `supersededBy` of a superseded shadow. */
  resolveShadow(id: string, precomputed?: GitRepoRoot, opts?: { supersession?: boolean }): Promise<{ supersededBy?: string[] } | null>;
  /** 2.1.68: the upstream's remote cleared of credentials, without a fetch or a path check. */
  upstreamRemoteUrl(): Promise<{ status: 'ok'; remote: string } | { status: 'skipped' } | { status: 'no-upstream' }>;
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
  /** 2.1.68: the runId of a finished Run to continue (`fdu51xri`). Not with `planPath`, `prompt` or `projectId`. */
  fromRunId?: string;
  /** 2.1.68: the continuation's instruction, passed as `continuation.instruction`. Only with `fromRunId`. */
  instruction?: string;
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
/** 2.1.68 (`hcdxxeja`): the host capability a continuation needs (`c4s-runner` M03 #30ufu17m). */
export const RUN_CONTINUATION_CAPABILITY = 'run-continuation';

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

const offersRuns = (h: RunRemoteHost) => h.capabilities.includes(RUNS_CAPABILITY);

/** `hcdxxeja`: a host named (or, for a continuation, inherited) must be connected and offer `runs`. */
function usableHost(host: RunRemoteHost): RunRemoteHost {
  if (host.status !== 'connected' || host.hostId === null || host.token === null) {
    return fail('RUN_HOST_NOT_CONNECTED', `runner host '${host.id}' is not connected (status: ${host.status})`);
  }
  if (!offersRuns(host)) return fail('RUN_HOST_WITHOUT_RUNS', `runner host '${host.id}' does not offer Runs`);
  return host;
}

/** `hcdxxeja`. */
function selectHost(hosts: RunRemoteHost[], requested: string | undefined): RunRemoteHost {
  if (requested !== undefined) {
    const host = hosts.find((h) => h.id === requested);
    if (!host) return fail('RUN_HOST_NOT_FOUND', `runner host '${requested}' does not exist`, undefined, { hosts: hostList(hosts) });
    return usableHost(host);
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

/** The parent of a continuation as `fdu51xri` step 2 recognizes it. */
interface ContinuationParent {
  runId: string;
  /** The tip of the local `refs/runs/<runId>/work` — the continuation's base sha (step 3). */
  tipSha: string;
  /** The parent's host: the registry row's `host_id`, else the record's `hostId` (`hcdxxeja`). */
  hostId: string;
  /** The `input` of the parent's record — a plan (a prompt input is refused). */
  input: { projectId: string; path: string };
}

/**
 * The parent's record, read by the shared reader of `run-read.ts`
 * (`readRunRecordAt`) without requiring `outcome`: recognition needs only
 * `hostId`, `input` and `reason`. It is read at the ref's tip sha — the very
 * sha that becomes the continuation's base — not by the ref's name.
 */
const readParentRecordAt = (deps: RunRemoteDeps, rev: string, recordAbs: string, repo: GitRepoRoot) =>
  readRunRecordAt((r, a, p) => deps.git.showFile(r, a, p), rev, recordAbs, repo, { requireOutcome: false });

/**
 * `fdu51xri` step 2 — the parent, in this order: not known (no registry row and
 * no record in this workspace's home — also a Run of another workspace) →
 * `RUN_PARENT_NOT_FOUND`; no local result ref (also a parent still running) →
 * `RUN_PARENT_WITHOUT_RESULT`; a `prompt` input in the record →
 * `RUN_PARENT_PROMPT_INPUT`; the record's `reason` `recipe-modified` →
 * `RUN_PARENT_RECIPE_MODIFIED`; the parent's shadow with `supersededBy` (M28
 * `dadc3w49`) → `RUN_PARENT_SUPERSEDED`. A parent already accepted (its tip an
 * ancestor of HEAD) is no refusal. Every refusal comes before the registry row.
 */
async function recognizeParent(
  deps: RunRemoteDeps,
  repo: GitRepoRoot,
  homeAbs: string,
  parentRunId: string,
): Promise<ContinuationParent> {
  const notFound = (): never =>
    fail(
      'RUN_PARENT_NOT_FOUND',
      `Run '${parentRunId}' is not known to this workspace: no registry row and no Run record in its home`,
      'pass the runId of a Run ordered from this workspace',
    );
  // A runId the runner would never accept names no Run of this master.
  if (!RUN_ID_PATTERN.test(parentRunId)) return notFound();
  const recordAbs = runRecordPath(homeAbs, parentRunId);
  const row = deps.registry().hostOf(parentRunId);
  const tipSha = await deps.git.shadowTip(`${parentRunId}/work`, repo);
  // The result ref exists iff its tip is the Run record (`c4s-runner` M07 #i6rgoy6k).
  const fromRef = tipSha !== null ? await readParentRecordAt(deps, tipSha, recordAbs, repo) : null;
  if (row === null && fromRef === null) {
    // A record accepted into HEAD (the ref since gone) still makes the parent known.
    const fromHead = await readParentRecordAt(deps, 'HEAD', recordAbs, repo);
    if (fromHead === null) return notFound();
  }
  if (tipSha === null || fromRef === null) {
    return fail(
      'RUN_PARENT_WITHOUT_RESULT',
      `Run '${parentRunId}' has no result ref refs/runs/${parentRunId}/work in this repository — it may still be running, or it left no result`,
      'call get_run for its state; continue only a Run that left a result',
    );
  }
  const input = fromRef.input as { kind?: unknown; projectId?: unknown; path?: unknown } | undefined;
  if (input && typeof input === 'object' && input.kind === 'prompt') {
    return fail(
      'RUN_PARENT_PROMPT_INPUT',
      `Run '${parentRunId}' executed a prompt — its record does not carry the prompt's text, so it cannot be continued`,
      'order a new Run with `prompt`',
    );
  }
  if (fromRef.reason === 'recipe-modified') {
    return fail(
      'RUN_PARENT_RECIPE_MODIFIED',
      `Run '${parentRunId}' changed the environment recipe (reason recipe-modified) — it cannot be continued`,
      'order a new Run from the upstream',
    );
  }
  // ASSUMPTION:dev-0005 (2.1.68) — supersession as M28 reads it for this project's shadow list (`dadc3w49`).
  const shadow = await deps.git.resolveShadow(`${parentRunId}/work`, repo, { supersession: true });
  if (shadow?.supersededBy && shadow.supersededBy.length > 0) {
    const children = shadow.supersededBy.map((id) => id.replace(/\/work$/, ''));
    return fail(
      'RUN_PARENT_SUPERSEDED',
      `the shadow of Run '${parentRunId}' is superseded by ${children.join(', ')}`,
      'continue the Run that superseded it',
      { supersededBy: children },
    );
  }
  if (!input || typeof input !== 'object' || typeof input.projectId !== 'string' || typeof input.path !== 'string') {
    // ASSUMPTION:dev-0005 (2.1.68) — a record whose input is not a readable plan input is no result to continue from.
    return fail('RUN_PARENT_WITHOUT_RESULT', `the record of Run '${parentRunId}' carries no readable plan input`);
  }
  return { runId: parentRunId, tipSha, hostId: row ?? fromRef.hostId, input: { projectId: input.projectId, path: input.path } };
}

/** `hcdxxeja`, continuation: the parent's host by default, any explicit one; each needs `run-continuation`. */
function selectContinuationHost(hosts: RunRemoteHost[], requested: string | undefined, parentHostId: string): RunRemoteHost {
  let host: RunRemoteHost;
  if (requested !== undefined) {
    host = selectHost(hosts, requested);
  } else {
    const parentHost = hosts.find((h) => h.hostId === parentHostId);
    if (!parentHost) {
      return fail('RUN_HOST_NOT_FOUND', `no runner host record has hostId '${parentHostId}', the host of the parent Run`, 'pass `host`', {
        hosts: hostList(hosts),
      });
    }
    host = usableHost(parentHost);
  }
  if (!host.capabilities.includes(RUN_CONTINUATION_CAPABILITY)) {
    return fail(
      'RUN_HOST_WITHOUT_CONTINUATION',
      `runner host '${host.id}' does not offer Run continuation (no '${RUN_CONTINUATION_CAPABILITY}' in its capabilities)`,
    );
  }
  return host;
}

/** What both orders share once their own steps are done: the host, the base, the input. */
interface PreparedOrder {
  host: RunRemoteHost;
  repoUrl: string;
  baseSha: string;
  projectId: string;
  runInput: RunInput;
  continuation?: RunContinuation;
}

export async function runRemote(deps: RunRemoteDeps, input: RunRemoteInput): Promise<RunRemoteResult> {
  // Addressing (mcp-tool `run-tools-run-remote` logic).
  if (input.planPath !== undefined && input.prompt !== undefined) {
    fail('INVALID_ARGS', '`planPath` and `prompt` are mutually exclusive');
  }
  if (input.fromRunId !== undefined) {
    const extra = (['planPath', 'prompt', 'projectId'] as const).filter((k) => input[k] !== undefined);
    if (extra.length > 0) {
      fail('INVALID_ARGS', `\`fromRunId\` takes the project and the plan from the parent's record — not together with ${extra.map((k) => `\`${k}\``).join(', ')}`);
    }
  } else if (input.instruction !== undefined) {
    fail('INVALID_ARGS', '`instruction` is only for a continuation — pass it with `fromRunId`');
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
  // The workspace home's directory, for every read at the base sha.
  const homeAbs = path.join(rootPath, home === '.' ? '' : home!);

  const order =
    input.fromRunId !== undefined
      ? await prepareContinuation(deps, input, repo!, homeAbs, input.fromRunId)
      : await prepareOrder(deps, input, home!, rootPath, workspace.name);

  // The definition's version against the recipe at the base sha (`kcxoa7qg`).
  const recipeAbs = path.join(homeAbs, ENVIRONMENT_RECIPE_PATH);
  checkRecipeVersion(await deps.git.showFile(order.baseSha, recipeAbs, repo!), agent!);

  // The trust in the order: the Run's project alone, its local consent, the path at the base sha.
  const { projectId } = order;
  const consent = deps.localConsent?.(projectId) ?? null;
  const needs = deps.consentNeeds?.(projectId) ?? { plugins: false, skillUses: [] };
  const basePath =
    consent !== null
      ? projectPathIn(await deps.git.showFile(order.baseSha, path.join(homeAbs, WORKSPACE_DESCRIPTION), repo!), projectId)
      : null;
  const trust = trustOf(projectId, consent, needs, basePath);

  const body: RunRequest = {
    repo: order.repoUrl,
    home: home!,
    baseSha: order.baseSha,
    agent: { name: agent!.name, version: agent!.version, content: agent!.content },
    input: order.runInput,
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    // `arzrwkiq`: no parameter → no field (the host's default applies); a given value passes unchanged.
    ...(input.timeoutMinutes !== undefined ? { timeoutMinutes: input.timeoutMinutes } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(trust.c4sTrust !== undefined ? { c4sTrust: trust.c4sTrust } : {}),
    ...(order.continuation !== undefined ? { continuation: order.continuation } : {}),
  };

  // Registry — runId → hostId (and the parent of a continuation); the trust stays out of it (`jlgucjnq`).
  const { host } = order;
  const runId = (deps.newRunId ?? newRunId)();
  const registry = deps.registry();
  registry.insert(runId, host.hostId!, order.continuation?.parentRunId ?? null);
  const result: RunRemoteResult = {
    runId,
    host: { id: host.id, name: host.name },
    ...(trust.warnings.length > 0 ? { warnings: trust.warnings } : {}),
  };

  // PUT — once; this operation never retries it.
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
 * `55a63udm` steps 1–4 of an order without a parent: the host, the publication
 * of a plan not pushed, the path on the upstream (the base sha and the cleared
 * remote), the `projectId` and the input.
 */
async function prepareOrder(
  deps: RunRemoteDeps,
  input: RunRemoteInput,
  home: string,
  rootPath: string,
  workspaceName: string,
): Promise<PreparedOrder> {
  // The input, resolved before anything leaves the machine. Step 4 (`55a63udm`,
  // `ffb3rhrs`) — the order's `projectId` — is decided here, because the plan
  // named explicitly is looked up in the plans directory of that project, and
  // its file is what steps 2–3 publish and check (ASSUMPTION:dev-5501).
  const projectId = input.projectId ?? deps.projectId;
  const project = deps.projects().find((p) => p.id === projectId);
  if (!project) {
    fail(
      'RUN_PROJECT_NOT_FOUND',
      `project '${projectId}' is not in workspace '${workspaceName}'`,
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
    if (planPath === null) fail('INVALID_ARGS', 'no plan is attached to this thread — pass `planPath`, `prompt` or `fromRunId`');
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
    const description = joinRel(home, WORKSPACE_DESCRIPTION);
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
  return { host, repoUrl: onUpstream.remote, baseSha: onUpstream.tipSha, projectId, runInput };
}

/**
 * `fdu51xri` steps 1–6 of a continuation: `fetch()`, the parent, the base sha
 * (the tip of the parent's local result ref), the host, no publication and no
 * path check on the upstream, the project and the plan from the parent's
 * record — the plan read at the base sha.
 */
async function prepareContinuation(
  deps: RunRemoteDeps,
  input: RunRemoteInput,
  repo: GitRepoRoot,
  homeAbs: string,
  parentRunId: string,
): Promise<PreparedOrder> {
  // 1. ASSUMPTION:dev-0005 (2.1.68) — a fetch that fails (busy, network) does not refuse here:
  // the parent is recognized from the local refs, as `get_run` reads them.
  await deps.git.fetch();
  // 2–3. The parent and the base sha.
  const parent = await recognizeParent(deps, repo, homeAbs, parentRunId);
  // 4. The host.
  const host = selectContinuationHost(deps.hosts(), input.host, parent.hostId);
  // ASSUMPTION:dev-0005 (2.1.68) — the order's `repo` is the upstream's remote cleared of credentials,
  // as for any order — only the path check is skipped; no upstream is RUN_NO_UPSTREAM.
  const upstream = await deps.git.upstreamRemoteUrl();
  if (upstream.status === 'skipped') fail('GIT_UNAVAILABLE', 'git is disabled, there is no repository, or HEAD is not on a branch');
  if (upstream.status === 'no-upstream') fail('RUN_NO_UPSTREAM', 'the current branch has no upstream');
  // 6. The project of the parent's record (checked before the plan, whose directory it names).
  const { projectId, path: planPath } = parent.input;
  const project = deps.projects().find((p) => p.id === projectId);
  if (!project) {
    fail('RUN_PROJECT_NOT_FOUND', `project '${projectId}' of the parent Run '${parentRunId}' is not in this workspace`);
  }
  // 5. No publication: the plan is the parent's plan at the base sha.
  const planAbs = path.join(project!.plansRoot, planPath);
  const inside = relativeInside(project!.plansRoot, planAbs) !== null;
  if (!inside || (await deps.git.showFile(parent.tipSha, planAbs, repo)) === null) {
    fail('PLAN_NOT_FOUND', `plan '${planPath}' of project '${projectId}' is not in the parent's result (${parent.tipSha})`);
  }
  return {
    host,
    repoUrl: (upstream as { status: 'ok'; remote: string }).remote,
    baseSha: parent.tipSha,
    projectId,
    runInput: { kind: 'plan', projectId, path: planPath },
    continuation: { parentRunId, ...(input.instruction !== undefined ? { instruction: input.instruction } : {}) },
  };
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

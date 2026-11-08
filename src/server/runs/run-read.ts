import path from 'node:path';
import type { GitShadow } from '../../shared/git.js';
import type { GitRepoRoot } from '../services/git.js';
import { homeRunsDir } from '../workspace/home-workspace.js';
import { runInputLocator, type RemoteRunRegistry } from './remote-run-registry.js';
import type { RunRemoteHost } from './run-remote.js';
import { RUN_ID_PATTERN } from './run-id.js';
import {
  cancelRunOverHttp,
  getRunOverHttp,
  mapRunnerApiCode,
  type RunnerRunCall,
  type RunnerRunOutcome,
} from './runner-runs-client.js';

/**
 * M55 — `get_run` (spec-operation `get-run`) and `cancel_run` (spec-operation
 * `cancel-run`): read and cancel a Run ordered earlier with `run_remote`.
 *
 * Both take the host from the Runs registry (`gsw1z1h3`) and ask it
 * (`c4s-runner` endpoints `get-runs-run-id`, `post-runs-run-id-cancel`). The
 * runner's answer is mapped by the shared table of `veec5qxa`
 * (`mapRunnerApiCode`), except for the three situations that lead to the path
 * to the record in git (`g9939pj0`): `404 run_not_found`, `404 not_found`
 * (a host that lost `runs`) and no registry row. On that path the operation
 * runs `fetch()`, reads the Run record (`<home>/.claude4spec/runs/<runId>/run.json`,
 * `c4s-runner` dto `run-record`) from the result ref or, after the shadow was
 * accepted, from HEAD, answers from it and restores the registry row from the
 * record's `hostId`. Without a record it refuses — `RUN_UNTRACEABLE`,
 * `RUN_HOST_WITHOUT_RUNS` or `RUN_UNKNOWN` — and the wording says that a
 * missing record does not mean the Run never existed.
 *
 * The answer is concise and carries no logs: state, outcome, reason, handoff
 * and `resultRef`, as the runner (or the record) gives them, never rewritten.
 * An unknown reason is reported as the general outcome (`h6qxem12`). A state
 * this master does not know is reported verbatim, marked `stateUnknown`, with
 * no separate branch (`d8r8kkrd`).
 *
 * `get_run` reads the shadow `<runId>/work` (`zozdbd1a`) only when the
 * runner's answer carries `resultSha`: `fetch()`, then the shadow list in
 * every project of the workspace.
 *
 * 2.1.68: `get_run` also gives `resultSha` and `parentRunId` as the runner
 * (or the record) gives them, a superseded shadow with `supersededBy` (the
 * children's runIds) and no plan hint for it; hints for the parent reasons.
 * 2.1.69: hints for `environment-failed` and `reserved-subject`; the latter
 * is a known reason, so it goes verbatim, not as the general outcome.
 * Neither operation deletes a shadow ref (`1la4achf`): the retention of
 * `refs/runs/<runId>/*` belongs to the master, which today deletes nothing —
 * the protective rule of `28fe18e4` (never a ref of an unaccepted continuation
 * chain, nor of a parent whose child is unfinished or unaccepted) binds any
 * deletion that comes later.
 */

export type RunReadErrorCode =
  | 'RUN_UNKNOWN'
  | 'RUN_UNTRACEABLE'
  | 'RUN_HOST_WITHOUT_RUNS'
  | 'RUN_HOST_NOT_FOUND'
  | 'RUN_HOST_UNAUTHENTICATED'
  | 'RUN_HOST_ERROR'
  | 'RUN_HOST_UNREACHABLE'
  | 'GIT_UNAVAILABLE';

/** `kodyBledow` of `get-run` and of `cancel-run` — the same eight codes, in the records' order. */
export const RUN_READ_ERROR_CODES: readonly RunReadErrorCode[] = [
  'RUN_UNKNOWN',
  'RUN_UNTRACEABLE',
  'RUN_HOST_WITHOUT_RUNS',
  'RUN_HOST_NOT_FOUND',
  'RUN_HOST_UNAUTHENTICATED',
  'RUN_HOST_ERROR',
  'RUN_HOST_UNREACHABLE',
  'GIT_UNAVAILABLE',
];

export class RunReadError extends Error {
  constructor(
    readonly code: RunReadErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'RunReadError';
  }
}

/** The refusal wordings of `get-run` (`zachowanie`), shared by `cancel-run`. */
export const RUN_UNTRACEABLE_MESSAGE =
  'Runner już nie zna tego Runu, a Run nie zostawił wyniku w gicie. Mógł zostać anulowany, przerwany albo odrzucony w przygotowaniu. Mógł też skończyć się awarią środowiska albo odrzuconym pushem. Host mógł go również usunąć po okresie retencji.';
export const RUN_UNKNOWN_MESSAGE = 'Master nie zna hosta tego Runu, a w gicie nie ma jego rekordu.';
export const RUN_HOST_WITHOUT_RUNS_MESSAGE =
  'Host tego Runu nie ma już API Runów (np. po restarcie bez Dockera), a Run nie zostawił wyniku w gicie. Brak rekordu nie znaczy, że Runu nie było: mógł zostać anulowany, przerwany albo odrzucony w przygotowaniu, skończyć się awarią środowiska albo odrzuconym pushem.';

/** `c4s-runner` dto `run`, field `reason`: the reasons this master knows (`h6qxem12`). */
export const KNOWN_RUN_REASONS: ReadonlySet<string> = new Set([
  'base-not-found',
  'workspace-not-found',
  'workspace-invalid',
  'plan-not-found',
  'project-not-found',
  'trust-path-mismatch',
  'recipe-not-found',
  'recipe-invalid',
  'prepare-failed',
  'c4s-failed',
  'environment-failed',
  'no-handoff',
  'handoff-invalid',
  'agent-failed',
  'recipe-modified',
  'push-rejected',
  // 2.1.68 — the reasons of a continuation's parent (`c4s-runner` M07 #h6qxem12, #i6rgoy6k).
  'parent-not-found',
  'parent-mismatch',
  'parent-recipe-modified',
  // 2.1.69 — a commit of the Run's agent took the subject reserved for the record commit (M55 `361n2mqb`).
  'reserved-subject',
  'timeout',
  'runner-restart',
]);

/**
 * M55 `361n2mqb`: the master's hint for the reasons of the table — the two
 * whose cause lies on the c4s side, 2.1.68 the three of a continuation's
 * parent and, 2.1.69, `environment-failed` (a failure of the Run's environment
 * on the host) and `reserved-subject` (a commit with the subject reserved for
 * the record commit). The reason itself goes verbatim; the hint stands next to
 * it (`reasonHint`, mcp-tool `run-tools-get-run` `returns`); the row carries
 * only the master's hint, the reason's meaning stays with the runner. A reason
 * outside this table goes without a hint.
 */
export const RUN_REASON_HINTS: Readonly<Record<string, string>> = {
  'c4s-failed':
    "Check the recipe's `c4sVersion` against the agent definition's minimum version, and the Run's log with the host's operator.",
  'trust-path-mismatch':
    "The local approval is for another path than the project's path at the base sha; approve the current path on this machine, then order a new Run with a new runId.",
  'parent-not-found':
    'This parent cannot be continued; order a new Run from the upstream, or a continuation of another Run of the chain.',
  'parent-mismatch':
    'Order the continuation again, with a new runId; if the refusal repeats, order a new Run from the upstream.',
  'parent-recipe-modified': 'The parent changed the environment recipe; order a new Run from the upstream.',
  'environment-failed':
    "The Run's environment failed on the host; the cause is in the Run's log with the host's operator. Order the Run again with a new runId once the failure was transient or the operator has fixed it.",
  'reserved-subject':
    "The Run's agent made a commit with the subject reserved for the record commit, so the Run left no result; fix the agent definition before ordering the Run again, with a new runId.",
};

/**
 * `c4s-runner` dto `run`, field `state`: the states this master knows. A state
 * outside this set is reported verbatim and marked `stateUnknown: true`
 * (`d8r8kkrd`, `get-run` `zachowanie`) — no separate branch: the shadow is
 * still read by `resultSha` alone (`zozdbd1a`).
 * ASSUMPTION:dev-5502 — the set and the marker's name are not in the specification.
 */
export const KNOWN_RUN_STATES: ReadonlySet<string> = new Set(['queued', 'preparing', 'running', 'finished']);

/** The record file inside the Run's record directory (`c4s-runner` dto `run-record`). */
export const RUN_RECORD_FILE = 'run.json';

export interface RunHandoff {
  summary: string;
  decisions: string[];
  conflicts: string[];
  commits: string[];
}

/** The Run as both operations report it — no logs, no other runner field. */
export interface RunView {
  runId: string;
  /** Where the answer comes from: the runner host or the Run record in git. */
  source: 'host' | 'record';
  /** The runner's state, verbatim — also one this master does not know. */
  state: string;
  /** Present (`true`) only when `state` is not one of `KNOWN_RUN_STATES`: unknown to this master. */
  stateUnknown?: true;
  outcome?: string;
  /** Absent when the runner gave none, or gave one this master does not know (the general outcome). */
  reason?: string;
  /** The master's hint to `reason` (`361n2mqb`, {@link RUN_REASON_HINTS}); present only for a reason of that table. */
  reasonHint?: string;
  handoff?: RunHandoff;
  resultRef?: string;
}

/** 2.1.68 (`get-run` `zachowanie`): the Run's lineage and result as `get_run` reports them. */
export interface RunLineage {
  /** The runner's `resultSha` (`c4s-runner` dto `run`), verbatim; absent when the runner gave none. */
  resultSha?: string;
  /** The direct parent of a continuation Run — the runner's or the record's `parentRunId`; absent otherwise. */
  parentRunId?: string;
}

export interface RunShadowProject {
  projectId: string;
  /** The shadow is on this project's shadow list (Releases → Shadows). */
  visible: boolean;
  /** When not visible: the shadow-list filter condition that rejected it. */
  filter?: string;
}

export interface RunShadowView {
  /** `<runId>/work`. */
  id: string;
  /** The shadow's tip is an ancestor of HEAD. */
  accepted: boolean;
  projects: RunShadowProject[];
  /** The result ref is not in the local repository even after `fetch()`. */
  refMissing?: true;
  /**
   * 2.1.68 (`zozdbd1a`, M28 `dadc3w49`): present only on a superseded shadow —
   * the runIds of the continuations that superseded it (`/work` cut off).
   */
  supersededBy?: string[];
}

export interface GetRunResult extends RunView, RunLineage {
  /** `null` when the Run left no result (`resultSha` absent) — the shadow is not read then. */
  shadow: RunShadowView | null;
  /** The plan-marking hint (outcome `done` and the shadow accepted, not superseded); the operation marks nothing. */
  hint: string | null;
}

export type CancelRunResult = RunView;

/** The M28 primitives over the repository of the workspace home. */
export interface RunReadGit {
  probeRepo(): Promise<GitRepoRoot | null>;
  fetch(): Promise<{ status: string }>;
  workspaceHomePath(home: string): Promise<string | null>;
  showFile(sha: string, absPath: string, precomputed?: GitRepoRoot): Promise<string | null>;
  isAncestorOfHead(sha: string): Promise<boolean>;
}

/** One project of the workspace, with its own shadow list (its own release-flag roots). */
export interface RunReadProject {
  projectId: string;
  git: {
    listShadows(): Promise<GitShadow[] | null>;
    resolveShadow(id: string): Promise<unknown | null>;
  };
}

export interface RunReadDeps {
  /** The workspace of this process, read per call. */
  workspace(): { name: string; home?: string };
  git: RunReadGit;
  /** Every project of the workspace (L10: one shadow list per project). */
  projects(): RunReadProject[];
  /** Every runner host of the workspace (M54 `43dazlrg`), read per call. */
  hosts(): RunRemoteHost[];
  /** The Runs registry; opened only in a workspace with a home. */
  registry(): RemoteRunRegistry;
  getRun?: RunnerRunCall;
  cancelRun?: RunnerRunCall;
}

export const PLAN_HINT =
  'The Run is done and its shadow is accepted: the plan can now be marked as applied. get_run does not mark it.';

/** Shadow-list filter conditions (M28 `dadc3w49`), as reported per project. */
export const FILTER_NO_COMMON_ANCESTOR = 'no common ancestor with HEAD';
export const FILTER_NO_RELEASE_CHANGE = 'changes no release-flag root of this project';

const fail = (code: RunReadErrorCode, message: string, hint?: string): never => {
  throw new RunReadError(code, message, hint);
};

type RecordTrigger = 'run_not_found' | 'not_found' | 'no-row';

interface RunRecord {
  hostId: string;
  outcome: string;
  reason?: string;
  handoff?: RunHandoff;
  resultRef?: string;
  input?: { kind?: unknown; projectId?: unknown; path?: unknown };
  parentRunId?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function pickHandoff(v: unknown): RunHandoff | undefined {
  if (!isObject(v) || typeof v.summary !== 'string') return undefined;
  const strings = (a: unknown): string[] => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);
  return { summary: v.summary, decisions: strings(v.decisions), conflicts: strings(v.conflicts), commits: strings(v.commits) };
}

/** `h6qxem12`: an unknown reason is reported as the general outcome — the reason is left out. */
function knownReason(v: unknown): string | undefined {
  return typeof v === 'string' && KNOWN_RUN_REASONS.has(v) ? v : undefined;
}

function viewOf(runId: string, source: RunView['source'], fields: Record<string, unknown>, state: string): RunView {
  const view: RunView = { runId, source, state };
  if (!KNOWN_RUN_STATES.has(state)) view.stateUnknown = true;
  if (typeof fields.outcome === 'string') view.outcome = fields.outcome;
  const reason = knownReason(fields.reason);
  if (reason !== undefined) view.reason = reason;
  if (reason !== undefined && Object.hasOwn(RUN_REASON_HINTS, reason)) view.reasonHint = RUN_REASON_HINTS[reason];
  const handoff = pickHandoff(fields.handoff);
  if (handoff) view.handoff = handoff;
  if (typeof fields.resultRef === 'string') view.resultRef = fields.resultRef;
  return view;
}

/**
 * The one reader of a Run record (`c4s-runner` dto `run-record`), shared by
 * `get_run` / `cancel_run` here and by the parent recognition of a
 * continuation (`run-remote.ts`, `fdu51xri` step 2). A record is a JSON object
 * with a string `hostId`; anything else is no record.
 *
 * `requireOutcome` is the one place the two readers differ: `get_run` answers
 * from the record and needs its `outcome` (a record without one is no record
 * for it), while the parent recognition reads only `hostId`, `input` and
 * `reason` and has never required `outcome` — keeping it a parameter keeps
 * both acceptances exactly as they were.
 */
export interface RunRecordFields {
  hostId: string;
  [field: string]: unknown;
}

export function parseRunRecord(text: string | null, opts: { requireOutcome: boolean }): RunRecordFields | null {
  if (text === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(v) || typeof v.hostId !== 'string') return null;
  if (opts.requireOutcome && typeof v.outcome !== 'string') return null;
  return v as RunRecordFields;
}

/** `<homeAbs>/runs/<runId>/run.json` — where a Run record lives inside the workspace home. */
export function runRecordPath(homeAbs: string, runId: string): string {
  return path.join(homeRunsDir(homeAbs), runId, RUN_RECORD_FILE);
}

/** The record at revision `rev` (a ref name, a sha or `HEAD`), parsed by {@link parseRunRecord}. */
export async function readRunRecordAt(
  showFile: (rev: string, absPath: string, precomputed?: GitRepoRoot) => Promise<string | null>,
  rev: string,
  recordAbs: string,
  repo: GitRepoRoot | undefined,
  opts: { requireOutcome: boolean },
): Promise<RunRecordFields | null> {
  return parseRunRecord(await showFile(rev, recordAbs, repo), opts);
}

/** `get_run` / `cancel_run` answer from the record, so its `outcome` is required. */
async function readFinishedRecordAt(deps: RunReadDeps, rev: string, recordAbs: string, repo: GitRepoRoot): Promise<RunRecord | null> {
  return (await readRunRecordAt((r, a, p) => deps.git.showFile(r, a, p), rev, recordAbs, repo, { requireOutcome: true })) as RunRecord | null;
}

/** The registry row's `hostId` — `null` without a home (no workspace DB) or for a runId the runner would never accept. */
function registeredHost(deps: RunReadDeps, runId: string): string | null {
  if (!recordAddressable(deps, runId)) return null;
  return deps.registry().hostOf(runId);
}

interface FoundRecord {
  record: RunRecord;
  /** Read from the result ref, or — the shadow accepted — from HEAD. */
  from: 'ref' | 'head';
}

/** A Run record has an address only with a home (workspace DB) and a runId the runner would accept. */
function recordAddressable(deps: RunReadDeps, runId: string): boolean {
  return deps.workspace().home !== undefined && RUN_ID_PATTERN.test(runId);
}

/** The absolute path of `<home>/runs/<runId>/run.json` in the repository at `rootPath`; `null` when it has none. */
async function recordFilePath(deps: RunReadDeps, rootPath: string | null | undefined, runId: string): Promise<string | null> {
  const home = deps.workspace().home;
  if (!rootPath || home === undefined || !recordAddressable(deps, runId)) return null;
  const homeRel = await deps.git.workspaceHomePath(home);
  return homeRel === null ? null : runRecordPath(path.join(rootPath, homeRel), runId);
}

/** `g9939pj0` steps 1–2: `fetch()`, then the record from the result ref, else from HEAD. */
async function readRecord(deps: RunReadDeps, runId: string): Promise<FoundRecord | null> {
  const repo = await deps.git.probeRepo();
  if (!repo) return fail('GIT_UNAVAILABLE', 'git is disabled or the project is not in a repository — the Run record cannot be read');
  if (!recordAddressable(deps, runId)) return null;
  // ASSUMPTION:dev-0007 — a fetch that fails (no upstream, busy, network) does not refuse: the record is read from the local refs.
  await deps.git.fetch();
  const recordAbs = await recordFilePath(deps, repo.rootPath, runId);
  if (recordAbs === null) return null;
  const fromRef = await readFinishedRecordAt(deps, `refs/runs/${runId}/work`, recordAbs, repo);
  if (fromRef) return { record: fromRef, from: 'ref' };
  const fromHead = await readFinishedRecordAt(deps, 'HEAD', recordAbs, repo);
  return fromHead ? { record: fromHead, from: 'head' } : null;
}

/** `g9939pj0` steps 2–3: answer from the record and restore the row, or refuse. */
async function recordPath(deps: RunReadDeps, runId: string, trigger: RecordTrigger): Promise<FoundRecord> {
  const found = await readRecord(deps, runId);
  if (!found) {
    if (trigger === 'run_not_found') return fail('RUN_UNTRACEABLE', RUN_UNTRACEABLE_MESSAGE);
    if (trigger === 'not_found') return fail('RUN_HOST_WITHOUT_RUNS', RUN_HOST_WITHOUT_RUNS_MESSAGE);
    return fail('RUN_UNKNOWN', RUN_UNKNOWN_MESSAGE);
  }
  const registry = deps.registry();
  if (registry.hostOf(runId) === null) {
    // 2.1.68 (`gsw1z1h3`): a row restored from the record takes `parent_run_id` from its `parentRunId`.
    // 2.1.73: and `project_id` / `plan_path` from the input of the Run's OWN record (also for a
    // continuation — never the parent's); the record knows no thread, so `thread_*` stay NULL.
    const { projectId, planPath } = runInputLocator(found.record.input);
    registry.insert({
      runId,
      hostId: found.record.hostId,
      parentRunId: parentOf(found.record),
      threadId: null,
      threadProjectId: null,
      projectId,
      planPath,
    });
  }
  return found;
}

/** The record's `parentRunId` when it is a runId-shaped string; `null` otherwise. */
function parentOf(fields: { parentRunId?: unknown }): string | null {
  return typeof fields.parentRunId === 'string' && fields.parentRunId !== '' ? fields.parentRunId : null;
}

/** 2.1.68: `resultSha` and `parentRunId` as the source gives them — never rewritten, absent when not given. */
function lineageOf(fields: Record<string, unknown>): RunLineage {
  const lineage: RunLineage = {};
  if (typeof fields.resultSha === 'string' && fields.resultSha !== '') lineage.resultSha = fields.resultSha;
  const parent = parentOf(fields);
  if (parent !== null) lineage.parentRunId = parent;
  return lineage;
}

function recordView(runId: string, record: RunRecord): RunView {
  // A record exists only for a finished Run whose result reached the remote.
  return viewOf(runId, 'record', record as unknown as Record<string, unknown>, 'finished');
}

type HostAnswer = { kind: 'run'; body: Record<string, unknown> } | { kind: 'record'; trigger: RecordTrigger };

/** Ask the registered host; the three record-path situations come back as `record`. */
async function askHost(deps: RunReadDeps, runId: string, call: RunnerRunCall): Promise<HostAnswer> {
  const hostId = registeredHost(deps, runId);
  if (hostId === null) return { kind: 'record', trigger: 'no-row' };
  const host = deps.hosts().find((h) => h.hostId === hostId);
  if (!host) return fail('RUN_HOST_NOT_FOUND', `no runner host record has hostId '${hostId}', the host of Run ${runId}`);
  if (host.token === null) {
    // ASSUMPTION:dev-0007 — a host whose token cannot be read is refused as unauthenticated: no request can carry it.
    return fail('RUN_HOST_UNAUTHENTICATED', `the token of runner host '${host.id}' cannot be read`);
  }
  const outcome: RunnerRunOutcome = await call({ url: host.url, token: host.token }, runId);
  if (outcome.kind === 'network') return fail('RUN_HOST_UNREACHABLE', `runner host '${host.id}' is unreachable: ${outcome.message}`);
  if (outcome.kind === 'error') {
    const { code, message } = outcome.error;
    if (code === 'run_not_found') return { kind: 'record', trigger: 'run_not_found' };
    if (code === 'not_found') return { kind: 'record', trigger: 'not_found' };
    return fail(mapRunnerApiCode(code), message ?? `runner host answered HTTP ${outcome.status}${code ? ` ${code}` : ''}`);
  }
  if (!isObject(outcome.body) || typeof outcome.body.state !== 'string') {
    return fail('RUN_HOST_ERROR', `runner host '${host.id}' answered HTTP ${outcome.status} without a Run`);
  }
  return { kind: 'run', body: outcome.body };
}

/** `zozdbd1a`: where the shadow `<runId>/work` stands, after `fetch()`. `tip` is `resultSha` or the result ref. */
async function readShadow(deps: RunReadDeps, runId: string, tip: string, recordAbs: string | null): Promise<RunShadowView> {
  const id = `${runId}/work`;
  if (await deps.git.isAncestorOfHead(tip)) return { id, accepted: true, projects: [] };
  // The result ref exists iff its tip is the Run record: no record at the tip → the ref did not reach this repository.
  if (recordAbs !== null && (await deps.git.showFile(tip, recordAbs)) === null) {
    return { id, accepted: false, projects: [], refMissing: true };
  }
  const projects: RunShadowProject[] = [];
  // 2.1.68 (`zozdbd1a`): the list of every project reports a superseded shadow with `supersededBy`.
  const supersededBy = new Set<string>();
  for (const project of deps.projects()) {
    const listed = await project.git.listShadows();
    if (listed === null) continue; // git off for that project — it has no shadow list
    const entry = listed.find((s) => s.id === id);
    if (entry) {
      projects.push({ projectId: project.projectId, visible: true });
      for (const child of entry.supersededBy ?? []) supersededBy.add(child.replace(/\/work$/, ''));
      continue;
    }
    // Not an ancestor of HEAD (checked above): with a common ancestor the release-root diff filter rejected it.
    const resolved = await project.git.resolveShadow(id);
    projects.push({
      projectId: project.projectId,
      visible: false,
      filter: resolved !== null ? FILTER_NO_RELEASE_CHANGE : FILTER_NO_COMMON_ANCESTOR,
    });
  }
  return supersededBy.size > 0 ? { id, accepted: false, projects, supersededBy: [...supersededBy] } : { id, accepted: false, projects };
}

async function recordAbsPath(deps: RunReadDeps, runId: string): Promise<string | null> {
  const repo = await deps.git.probeRepo();
  return recordFilePath(deps, repo?.rootPath, runId);
}

function planHint(view: RunView, shadow: RunShadowView | null, input: unknown): string | null {
  // 2.1.68: no hint for a superseded shadow.
  if (view.outcome !== 'done' || !shadow?.accepted || shadow.supersededBy) return null;
  if (isObject(input) && input.kind !== undefined && input.kind !== 'plan') return null;
  return PLAN_HINT;
}

export async function getRun(deps: RunReadDeps, input: { runId: string }): Promise<GetRunResult> {
  const { runId } = input;
  const answer = await askHost(deps, runId, deps.getRun ?? getRunOverHttp);
  if (answer.kind === 'run') {
    const view = viewOf(runId, 'host', answer.body, answer.body.state as string);
    let shadow: RunShadowView | null = null;
    if (typeof answer.body.resultSha === 'string' && answer.body.resultSha !== '') {
      if (await deps.git.probeRepo()) {
        await deps.git.fetch();
        shadow = await readShadow(deps, runId, answer.body.resultSha, await recordAbsPath(deps, runId));
      }
      // ASSUMPTION:dev-0007 — git unavailable: the host's state is still reported, with `shadow: null`.
    }
    return { ...view, ...lineageOf(answer.body), shadow, hint: planHint(view, shadow, answer.body.input) };
  }
  const found = await recordPath(deps, runId, answer.trigger);
  const view = recordView(runId, found.record);
  const shadow =
    found.from === 'head'
      ? { id: `${runId}/work`, accepted: true, projects: [] }
      : await readShadow(deps, runId, `refs/runs/${runId}/work`, null);
  return {
    ...view,
    ...lineageOf(found.record as unknown as Record<string, unknown>),
    shadow,
    hint: planHint(view, shadow, found.record.input),
  };
}

export async function cancelRun(deps: RunReadDeps, input: { runId: string }): Promise<CancelRunResult> {
  const { runId } = input;
  const answer = await askHost(deps, runId, deps.cancelRun ?? cancelRunOverHttp);
  if (answer.kind === 'run') return viewOf(runId, 'host', answer.body, answer.body.state as string);
  // With a record the Run is finished and stays unchanged.
  const found = await recordPath(deps, runId, answer.trigger);
  return recordView(runId, found.record);
}

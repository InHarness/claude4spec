import path from 'node:path';
import type { StartOptions } from '../server/index.js';
import type { WorkspaceRegistry } from '../server/workspace/registry.js';
import { startWarnings } from '../server/workspace/network-flags.js';
import { effectiveBindHost, type WorkspaceNetwork } from '../core/workspace/network.js';
import type { ProjectRecord, StoredWorkspaceRecord, WorkspaceRecord } from '../server/workspace/types.js';
import { isRemoteApiUrl } from '../server/config.js';

/**
 * The launcher's argument parsing and the side-effect-light steps of a start,
 * carved out of `claude4spec.ts` (which runs on import) so they can be tested.
 */

export interface CliArgs {
  port?: number;
  cwd: string;
  mode?: 'dev' | 'prod';
  /** M31: workspace selector (`--workspace <name>`); absent = port/default resolution. */
  workspace?: string;
  noOpen: boolean;
  /**
   * 2.1.58 (M01 `3ebblo1q`): `--remote-url <url>` — the remote claude4spec-API
   * base for the process lifetime, for every project of the workspace; never
   * written to any `config.json`, so it is not a project-config input and does
   * not register the CWD. Validated once here with M24's rule for
   * `remoteApiUrl` (an http(s) URL); an empty value is absent.
   */
  remoteUrl?: string;
  /**
   * Decision #11 (0.1.57): `--create-project` — explicit opt-in to register the
   * CWD as a workspace project. Non-sticky (never written to config.json).
   * Implied by `--cwd`. 2.1.58: registration only — the project is activated on
   * its first request, like every other. Without it the bare command is a
   * workspace-only start that writes nothing to the CWD and opens `/welcome`.
   */
  createProject: boolean;
  /**
   * 2.1.0: `--host <addr>` — the workspace's listen address (`bindHost`).
   * Persisted in the registry; `''` (`--host=`) restores loopback. Not a selector.
   */
  host?: string;
  /**
   * 2.1.0: `--public-url <url>` — the origin clients see. Persisted in the
   * registry; `''` restores `http://localhost:<port>`. Not a selector.
   */
  publicUrl?: string;
}

export function parseLaunchArgs(argv: string[], baseCwd: string = process.cwd()): CliArgs {
  const args: CliArgs = {
    port: undefined,
    cwd: baseCwd,
    mode: undefined,
    workspace: undefined,
    noOpen: false,
    remoteUrl: undefined,
    createProject: false,
    host: undefined,
    publicUrl: undefined,
  };
  // `cwd` always defaults to process.cwd(), so its value can't signal intent —
  // track whether `--cwd` was passed explicitly to drive the create-project
  // implication.
  let cwdExplicit = false;
  const resolveCwd = (raw: string) => path.resolve(baseCwd, raw);
  const parseMode = (raw: string): 'dev' | 'prod' => {
    if (raw !== 'dev' && raw !== 'prod') throw new Error(`--mode must be 'dev' or 'prod', got '${raw}'`);
    return raw;
  };
  // M24 owns the rule (`isRemoteApiUrl`, the one `config.remoteApiUrl` passes);
  // an invalid value refuses the start, an empty one (`--remote-url=`) is absent
  // so `config.remoteApiUrl` still applies.
  const parseRemoteUrl = (raw: string): string | undefined => {
    const value = raw.trim();
    if (value === '') return undefined;
    // ASSUMPTION:dev-0203 — the wording of the refusal (not settled by the pages).
    if (!isRemoteApiUrl(value)) throw new Error(`--remote-url must be an http(s) URL, got '${raw}'`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) {
      args.port = Number(argv[++i]);
    } else if (a?.startsWith('--port=')) {
      args.port = Number(a.split('=')[1]);
    } else if (a === '--cwd' && argv[i + 1]) {
      args.cwd = resolveCwd(argv[++i]!);
      cwdExplicit = true;
    } else if (a?.startsWith('--cwd=')) {
      args.cwd = resolveCwd(a.split('=')[1]!);
      cwdExplicit = true;
    } else if (a === '--mode' && argv[i + 1]) {
      args.mode = parseMode(argv[++i]!);
    } else if (a?.startsWith('--mode=')) {
      args.mode = parseMode(a.split('=')[1]!);
    } else if (a === '--workspace' && argv[i + 1]) {
      args.workspace = argv[++i];
    } else if (a?.startsWith('--workspace=')) {
      args.workspace = a.split('=')[1];
    } else if (a === '--remote-url' && argv[i + 1]) {
      args.remoteUrl = parseRemoteUrl(argv[++i]!);
    } else if (a?.startsWith('--remote-url=')) {
      args.remoteUrl = parseRemoteUrl(a.slice('--remote-url='.length));
    } else if (a === '--host' && argv[i + 1] !== undefined) {
      args.host = argv[++i];
    } else if (a?.startsWith('--host=')) {
      args.host = a.slice('--host='.length);
    } else if (a === '--public-url' && argv[i + 1] !== undefined) {
      args.publicUrl = argv[++i];
    } else if (a?.startsWith('--public-url=')) {
      args.publicUrl = a.slice('--public-url='.length);
    } else if (a === '--create-project') {
      args.createProject = true;
    } else if (a === '--no-open') {
      args.noOpen = true;
    }
  }
  // Decision #11: `--cwd` implies `--create-project`. 2.1.58 (M01 `3ebblo1q`):
  // the command line is no project-config input any more — there is no
  // `--name`/`--pages`, and `--remote-url` is a process value, so neither
  // registers the CWD.
  if (cwdExplicit) args.createProject = true;
  return args;
}

/**
 * The address a create-project start opens: the project's own page under the
 * LOCAL server address (loopback or a concrete bindHost, never `publicUrl`);
 * a fresh directory redirects from there to onboarding.
 */
export function projectStartUrl(localUrl: string, projectId: string): string {
  return `${localUrl}/p/${projectId}/`;
}

/** What the start selects a workspace by: `--workspace`, then the port, then the default. */
export interface WorkspaceSelector {
  name?: string;
  port?: number;
  mode?: 'dev' | 'prod';
}

/**
 * Persist `--host` / `--public-url` on the selected entry (and print the start
 * warnings). Works on the stored entry, so it reads no `workspace.json`.
 */
export type NetworkStep = (entry: StoredWorkspaceRecord) => StoredWorkspaceRecord;

/**
 * 2.1.58 (M31 `ssn335r8`): select the start's workspace and open its view —
 * the ONLY read of a home's `workspace.json` before listen. The entry is
 * selected (or created) from the registry alone, the network flags land on
 * that entry, and only then does `openView` ensure `.claude4spec/.gitignore`
 * and read and validate the file strictly (a `WorkspaceFileError` refuses the
 * start). The view is handed to `startServer` together with this registry, so
 * the server never reads the file again.
 */
export function openStartWorkspace(
  registry: WorkspaceRegistry,
  select: WorkspaceSelector,
  network: NetworkStep = (entry) => entry,
): WorkspaceRecord {
  const entry = network(registry.selectOrCreateEntry(select));
  return registry.openView(entry.name);
}

/** Everything a start does before listen, and the options it then listens with. */
export interface PreparedStart {
  /** The view `startServer` serves (after the registration, on a create-project start). */
  workspace: WorkspaceRecord;
  /**
   * The project a create-project start registered (NOT activated — it is
   * activated on its first request); `null` on a workspace-only start.
   */
  project: ProjectRecord | null;
  port: number;
  mode: 'dev' | 'prod';
  options: StartOptions;
}

/**
 * The launcher's pre-listen sequence (`claude4spec.ts` runs exactly this, then
 * `startServer(prepared.options)`). 2.1.58 (M01 `dsh8ezbz`, M31 `m31ctx001`):
 * no project is activated or built here — not even the one a create-project
 * start names. Every project activates on its first request, from the file and
 * the defaults, so a broken `config.json` is that activation's error and never
 * refuses the start.
 *
 *  - create-project (`--create-project` or `--cwd`): open the workspace, then
 *    REGISTER the CWD (an entry in the registry / `workspace.json` and the slot
 *    marker) — nothing is written to the CWD;
 *  - workspace-only (decision #11, the bare command): no registration — nothing
 *    is written to the CWD; the CWD is never registered, even when it already
 *    carries a `.claude4spec/config.json`.
 *
 * Either way the workspace is opened by `openStartWorkspace`, and the server
 * gets this registry and that view — not a second registry of its own.
 */
export function prepareStart(
  registry: WorkspaceRegistry,
  args: CliArgs,
  network: NetworkStep = (entry) => entry,
): PreparedStart {
  const opened = openStartWorkspace(registry, { name: args.workspace, port: args.port, mode: args.mode }, network);
  // A `--cwd` at a workspace home is registered here as given: its refusal (and
  // `--cwd` naming the workspace home) is the start's workspace rule, owned by
  // the `workspace-selection-at-start` unit (M31 flag combinations). Until then
  // such a project answers its activation's refusal on its first request.
  const project = args.createProject ? registry.registerProject(opened, args.cwd) : null;
  // The view after the registration (this registry's own write — no re-read).
  const workspace = project ? (registry.getWorkspace(opened.name) ?? opened) : opened;
  const port = args.port ?? opened.defaultPort;
  const mode = args.mode ?? opened.mode;
  return {
    workspace,
    project,
    port,
    mode,
    options: {
      cwd: args.cwd,
      registry,
      workspace,
      port,
      host: effectiveBindHost(workspace),
      mode,
      remoteApiUrl: args.remoteUrl,
    },
  };
}

/**
 * Print every start warning for the workspace's network attributes — on EVERY
 * start, since a non-loopback `bindHost` persists. Returns what was printed.
 */
export function printStartWarnings(
  ws: WorkspaceNetwork,
  warn: (line: string) => void = (line) => console.warn(line),
): string[] {
  const warnings = startWarnings(ws);
  for (const w of warnings) warn(`\x1b[33m  ${w}\x1b[0m`);
  return warnings;
}

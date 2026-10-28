import fs from 'node:fs';
import path from 'node:path';
import type { StartOptions } from '../server/index.js';
import { migrateConfigToV3 } from '../server/config.js';
import type { WorkspaceRegistry } from '../server/workspace/registry.js';
import { bootstrapProject, type BootstrapResult } from '../server/workspace/bootstrap.js';
import { startWarnings } from '../server/workspace/network-flags.js';
import { effectiveBindHost, type WorkspaceNetwork } from '../core/workspace/network.js';
import type { StoredWorkspaceRecord, WorkspaceRecord } from '../server/workspace/types.js';

/**
 * The launcher's argument parsing and the side-effect-light steps of a start,
 * carved out of `claude4spec.ts` (which runs on import) so they can be tested.
 */

export interface CliArgs {
  port?: number;
  cwd: string;
  pagesDir?: string;
  mode?: 'dev' | 'prod';
  name?: string;
  /** M31: workspace selector (`--workspace <name>`); absent = port/default resolution. */
  workspace?: string;
  noOpen: boolean;
  /**
   * M01 (0.1.36): `--remote-url <url>` — sticky override of the remote
   * claude4spec-API base. Maps to config `remoteApiUrl`; persisted on first
   * bootstrap so later sign-ins target the same remote.
   */
  remoteUrl?: string;
  /**
   * Decision #11 (0.1.57): `--create-project` — explicit opt-in to register the
   * CWD as a workspace project. Non-sticky (never written to config.json).
   * Implied by any per-project flag (`--cwd`/`--name`/`--pages`/
   * `--remote-url`). Without it the bare command is a workspace-only start that
   * writes nothing to the CWD and opens `/welcome`.
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
    pagesDir: undefined,
    mode: undefined,
    name: undefined,
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
    } else if (a === '--pages' && argv[i + 1]) {
      args.pagesDir = argv[++i];
    } else if (a?.startsWith('--pages=')) {
      args.pagesDir = a.split('=')[1];
    } else if (a === '--mode' && argv[i + 1]) {
      args.mode = parseMode(argv[++i]!);
    } else if (a?.startsWith('--mode=')) {
      args.mode = parseMode(a.split('=')[1]!);
    } else if (a === '--name' && argv[i + 1]) {
      args.name = argv[++i];
    } else if (a?.startsWith('--name=')) {
      args.name = a.split('=')[1];
    } else if (a === '--workspace' && argv[i + 1]) {
      args.workspace = argv[++i];
    } else if (a?.startsWith('--workspace=')) {
      args.workspace = a.split('=')[1];
    } else if (a === '--remote-url' && argv[i + 1]) {
      args.remoteUrl = argv[++i];
    } else if (a?.startsWith('--remote-url=')) {
      args.remoteUrl = a.split('=')[1];
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
  // Decision #11: per-project flags imply `--create-project` — each acted on the
  // CWD project in 0.1.56, so their use still registers it (eases migration).
  if (
    cwdExplicit ||
    args.name != null ||
    args.pagesDir != null ||
    args.remoteUrl != null
  ) {
    args.createProject = true;
  }
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
  /** The view `startServer` serves (after the bootstrap's registration, on a create-project start). */
  workspace: WorkspaceRecord;
  /** The create-project activation; `null` on a workspace-only start. */
  boot: BootstrapResult | null;
  port: number;
  mode: 'dev' | 'prod';
  options: StartOptions;
}

/**
 * The launcher's pre-listen sequence (`claude4spec.ts` runs exactly this, then
 * `startServer(prepared.options)`):
 *
 *  - create-project (`--create-project` or an implying flag): mkdir the CWD,
 *    peek the config-v3 migration (a pre-v3 `config.json.port` can still select
 *    the workspace; the first-wins carry happens in the bootstrap), open the
 *    workspace, then run the full per-project activation (M31 bootstrap);
 *  - workspace-only (decision #11, the bare command): no mkdir, no config peek
 *    (it would rewrite `config.json`), no bootstrap — nothing is written to the
 *    CWD; the CWD is never registered, even when it already carries a
 *    `.claude4spec/config.json`.
 *
 * Either way the workspace is opened by `openStartWorkspace`, and the server
 * gets this registry and that view — not a second registry of its own.
 */
export function prepareStart(
  registry: WorkspaceRegistry,
  args: CliArgs,
  network: NetworkStep = (entry) => entry,
): PreparedStart {
  if (!args.createProject) {
    const workspace = openStartWorkspace(registry, { name: args.workspace, port: args.port, mode: args.mode }, network);
    const port = args.port ?? workspace.defaultPort;
    const mode = args.mode ?? workspace.mode;
    return {
      workspace,
      boot: null,
      port,
      mode,
      options: { cwd: args.cwd, registry, workspace, initialProject: null, port, host: effectiveBindHost(workspace), mode },
    };
  }
  fs.mkdirSync(args.cwd, { recursive: true });
  const peeked = migrateConfigToV3(args.cwd);
  const opened = openStartWorkspace(
    registry,
    {
      name: args.workspace,
      port: args.port ?? peeked.carried.defaultPort,
      mode: args.mode ?? peeked.carried.mode,
    },
    network,
  );
  const boot = bootstrapProject(registry, opened, args.cwd, {
    name: args.name,
    pagesDir: args.pagesDir,
    remoteApiUrl: args.remoteUrl,
  });
  // The view after the registration (this registry's own write — no re-read).
  const workspace = registry.getWorkspace(opened.name) ?? opened;
  const port = args.port ?? opened.defaultPort;
  const mode = args.mode ?? opened.mode;
  return {
    workspace,
    boot,
    port,
    mode,
    options: {
      cwd: args.cwd,
      registry,
      workspace,
      initialProject: boot.project,
      port,
      host: effectiveBindHost(workspace),
      pagesDir: args.pagesDir,
      mode,
      // Resolved flag > config.json > null; startServer applies the prod-constant
      // fallback inside RemoteHttpClient.
      remoteApiUrl: boot.config.remoteApiUrl,
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

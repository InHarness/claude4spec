import path from 'node:path';
import type { WorkspaceRegistry } from '../server/workspace/registry.js';
import { startWarnings } from '../server/workspace/network-flags.js';
import type { WorkspaceNetwork } from '../core/workspace/network.js';
import type { WorkspaceRecord } from '../server/workspace/types.js';

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

/**
 * The workspace-only start (decision #11): the bare command, with no flag that
 * implies `--create-project`. It only selects (or creates) the workspace — it
 * never registers the CWD, even when the CWD already carries a
 * `.claude4spec/config.json`, and writes nothing into it. `network` persists
 * `--host` / `--public-url` on the selected workspace.
 */
export function workspaceOnlyLaunch(
  registry: WorkspaceRegistry,
  args: Pick<CliArgs, 'workspace' | 'port' | 'mode'>,
  network: (ws: WorkspaceRecord) => WorkspaceRecord = (ws) => ws,
): WorkspaceRecord {
  return network(registry.selectOrCreate({ name: args.workspace, port: args.port, mode: args.mode }));
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

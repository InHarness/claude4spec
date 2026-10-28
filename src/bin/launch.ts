import path from 'node:path';
import type { StartOptions } from '../server/index.js';
import type { WorkspaceRegistry } from '../server/workspace/registry.js';
import { startWarnings } from '../server/workspace/network-flags.js';
import { effectiveBindHost, type WorkspaceNetwork } from '../core/workspace/network.js';
import type { StoredWorkspaceRecord, WorkspaceRecord } from '../server/workspace/types.js';
import type { WorkspaceSelection } from '../server/workspace/start-selection.js';
import { isRemoteApiUrl } from '../server/config.js';

/**
 * The launcher's argument parsing and the side-effect-light steps of a start,
 * carved out of `claude4spec.ts` (which runs on import) so they can be tested.
 */

export interface CliArgs {
  /**
   * 2.1.58 (M31 `m31wsel01`): `--port <n>`. Alone a selector (the entry with
   * that `defaultPort`, else a new registry entry); with `--workspace` /
   * `--cwd` it overrides and persists the selected entry's `defaultPort`.
   * Absent: the entry's own port (a new one gets the first free from 4500).
   */
  port?: number;
  /**
   * 2.1.58: `--cwd <path>` — the workspace HOME directory, resolved against the
   * launch directory; never a project directory, never written by itself (only
   * the registry entry the selection creates records it). Absent = not given.
   */
  cwd?: string;
  /** The directory the command was run in: the walk-up of a bare command starts here. */
  launchDir: string;
  /** `--mode` (internal, the dev script): seeds `mode` of a NEW workspace entry only. */
  mode?: 'dev' | 'prod';
  /** `--workspace <name>`: selects or creates the workspace by name. */
  workspace?: string;
  /** `--no-open`: no browser at the start; a runtime preference, never persisted. */
  noOpen: boolean;
  /**
   * 2.1.58 (M01 `3ebblo1q`): `--remote-url <url>` — the remote claude4spec-API
   * base for the process lifetime, for every project of the workspace; never
   * written to any file. Validated once here with M24's rule for
   * `remoteApiUrl` (an http(s) URL); an empty value is absent.
   */
  remoteUrl?: string;
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

/**
 * The start flags (M01 sheet `flagi-cli-m01`): `--cwd`, `--workspace`,
 * `--port`, `--host`, `--public-url`, `--mode`, `--no-open`, `--remote-url`.
 * They concern the workspace and the process, never a project: there is no
 * flag carrying project configuration and no flag registering a directory as a
 * project — any other argument is not read.
 */
export function parseLaunchArgs(argv: string[], launchDir: string = process.cwd()): CliArgs {
  const args: CliArgs = {
    port: undefined,
    cwd: undefined,
    launchDir,
    mode: undefined,
    workspace: undefined,
    noOpen: false,
    remoteUrl: undefined,
    host: undefined,
    publicUrl: undefined,
  };
  const resolveCwd = (raw: string) => path.resolve(launchDir, raw);
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
    } else if (a?.startsWith('--cwd=')) {
      args.cwd = resolveCwd(a.slice('--cwd='.length));
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
    } else if (a === '--no-open') {
      args.noOpen = true;
    }
  }
  return args;
}

/**
 * 2.1.58 (M01 `r7ozfsa9`): the path the start opens in the browser — the
 * workspace's last opened project, or the workspace welcome page when there is
 * none or it is no longer in the workspace. Nothing is activated by choosing it.
 */
export function startPath(ws: Pick<WorkspaceRecord, 'projects' | 'lastOpenedProject'>): string {
  const id = ws.lastOpenedProject;
  return id !== undefined && ws.projects.some((p) => p.id === id) ? `/p/${id}/` : '/welcome';
}

/**
 * Persist `--host` / `--public-url` on the selected entry (and print the start
 * warnings). Works on the stored entry, so it reads no `workspace.json`.
 */
export type NetworkStep = (entry: StoredWorkspaceRecord) => StoredWorkspaceRecord;

/**
 * 2.1.58 (M31 `ssn335r8`, `m31wsel01`): select the start's workspace by the
 * selection rule and open its view — the ONLY read of a home's
 * `workspace.json` before listen. The entry is selected (or created) from the
 * registry alone, the network flags land on that entry, and only then does
 * `openView` ensure `.claude4spec/.gitignore` and read and validate the file
 * strictly (a `WorkspaceFileError` refuses the start). A refusal of the flag
 * combinations (`WorkspaceSelectionError`) comes before anything is written.
 */
export function openStartWorkspace(
  registry: WorkspaceRegistry,
  select: WorkspaceSelection,
  network: NetworkStep = (entry) => entry,
): WorkspaceRecord {
  const entry = network(registry.selectOrCreateEntry(select));
  return registry.openView(entry.name);
}

/** Everything a start does before listen, and the options it then listens with. */
export interface PreparedStart {
  /** The view `startServer` serves. */
  workspace: WorkspaceRecord;
  /** The selected entry's `mode` — `--mode` seeds only a new entry. */
  mode: 'dev' | 'prod';
  /** What the browser opens under the local address (`startPath`). */
  openPath: string;
  options: StartOptions;
}

/**
 * The launcher's pre-listen sequence (`claude4spec.ts` runs exactly this, then
 * `startServer(prepared.options)`). 2.1.58 (M01 `r7ozfsa9`, M31 `m31ctx001`):
 * the start selects a workspace and opens its view; no project is registered,
 * activated or built here — 2.1.60: the server builds every project in the
 * background after listen (M31 `m31ctx001`), and projects are added from the
 * UI or in the home's `workspace.json`. The server
 * gets this registry and that view — not a second registry of its own.
 */
export function prepareStart(
  registry: WorkspaceRegistry,
  args: CliArgs,
  network: NetworkStep = (entry) => entry,
): PreparedStart {
  const workspace = openStartWorkspace(
    registry,
    { name: args.workspace, cwd: args.cwd, port: args.port, mode: args.mode, launchDir: args.launchDir },
    network,
  );
  // ASSUMPTION:dev-0505 — `--mode` for an existing entry is ignored entirely:
  // the process runs in the entry's own mode.
  return {
    workspace,
    mode: workspace.mode,
    openPath: startPath(workspace),
    options: {
      cwd: args.launchDir,
      registry,
      workspace,
      port: workspace.defaultPort,
      host: effectiveBindHost(workspace),
      mode: workspace.mode,
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

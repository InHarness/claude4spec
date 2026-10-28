#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { startServer } from '../server/index.js';
import { WorkspaceRegistry } from '../server/workspace/registry.js';
import {
  applyNetworkFlags,
  InvalidPublicUrlError,
} from '../server/workspace/network-flags.js';
import { effectivePublicUrl } from '../core/workspace/network.js';
import type { StoredWorkspaceRecord } from '../server/workspace/types.js';
import { WorkspaceSelectionError } from '../server/workspace/start-selection.js';
import { parseLaunchArgs, prepareStart, printStartWarnings, type CliArgs, type PreparedStart } from './launch.js';

function openBrowser(url: string): void {
  const { platform } = process;
  const [cmd, ...rest] =
    platform === 'darwin'
      ? ['open', url]
      : platform === 'win32'
        ? ['cmd', '/c', 'start', '""', url]
        : ['xdg-open', url];
  try {
    const child = spawn(cmd!, rest, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      /* ignore — terminal link still works */
    });
    child.unref();
  } catch {
    /* ignore */
  }
}

// An invalid flag value (`--mode`, `--remote-url`) refuses the start before
// anything is read or written.
let args: CliArgs;
try {
  args = parseLaunchArgs(process.argv.slice(2));
} catch (err) {
  console.error(`\x1b[31mINVALID_ARGS\x1b[0m — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
const { noOpen } = args;

const registry = new WorkspaceRegistry();

// 2.1.0: hash project ids → readable ids, BEFORE anything else touches the
// registry (writes refuse on an unmigrated file). Idempotent and resumable.
for (const r of registry.migrateIfNeeded()) {
  console.log(`  migrated project id ${r.from} → ${r.to} (workspace ${r.workspace})`);
}

/**
 * Persist `--host`/`--public-url` on the selected workspace entry and print the
 * no-auth warning when it listens beyond loopback. An invalid `--public-url`
 * refuses the start before anything is written.
 */
function withNetwork(entry: StoredWorkspaceRecord): StoredWorkspaceRecord {
  let next: StoredWorkspaceRecord;
  try {
    next = applyNetworkFlags(registry, entry, { host: args.host, publicUrl: args.publicUrl });
  } catch (err) {
    if (err instanceof InvalidPublicUrlError) {
      console.error(`\x1b[31mINVALID_ARGS\x1b[0m — ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  printStartWarnings(next);
  return next;
}

// Everything before listen — the workspace selection rule (a refused flag
// combination exits here, before anything is written) and the single eager
// read of a home's workspace.json (after its .gitignore). No project is
// registered, activated or built before listen: each activates on its first
// request. startServer gets this registry and its view.
let prepared: PreparedStart;
try {
  prepared = prepareStart(registry, args, withNetwork);
} catch (err) {
  // ASSUMPTION:dev-0506 — a refused combination prints `<CODE> — <message>`
  // and `hint: …`, and exits 1.
  if (err instanceof WorkspaceSelectionError) {
    console.error(`\x1b[31m${err.code}\x1b[0m — ${err.message}`);
    console.error(`  hint: ${err.hint}`);
    process.exit(1);
  }
  failToStart(err);
}
const { workspace } = prepared;

startServer(prepared.options)
  .then((handle) => {
    // `handle.url` is the LOCAL address (loopback or a concrete bindHost) — the
    // browser opens that, never `publicUrl`: the last opened project of the
    // workspace, else the welcome page. Nothing is activated before that request.
    const openUrl = `${handle.url}${prepared.openPath}`;
    console.log(`\x1b[32m  claude4spec\x1b[0m  ready at \x1b[36m${openUrl}\x1b[0m`);
    console.log(`  workspace: ${workspace.name}${workspace.home !== undefined ? ` (home ${workspace.home})` : ''}`);
    console.log(`  public url: ${effectivePublicUrl(workspace)}`);
    if (!noOpen && prepared.mode === 'prod') openBrowser(openUrl);
    installShutdown(handle);
  })
  .catch(failToStart);

function installShutdown(handle: Awaited<ReturnType<typeof startServer>>): void {
  const close = async () => {
    console.log('\n  shutting down…');
    await handle.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

function failToStart(err: unknown): never {
  console.error('failed to start:', err);
  process.exit(1);
}

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
import { parseLaunchArgs, prepareStart, printStartWarnings, projectStartUrl, type PreparedStart } from './launch.js';

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

const args = parseLaunchArgs(process.argv.slice(2));
const { port, cwd, pagesDir, noOpen } = args;

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
  printStartWarnings({ ...next, defaultPort: port ?? next.defaultPort });
  return next;
}

// Everything before listen — workspace selection, the single eager read of a
// home's workspace.json (after its .gitignore), and on a create-project start
// the per-project activation. startServer gets this registry and its view.
let prepared: PreparedStart;
try {
  prepared = prepareStart(registry, args, withNetwork);
} catch (err) {
  failToStart(err);
}
const { workspace, boot } = prepared;
const effectivePort = prepared.port;
const effectiveMode = prepared.mode;

startServer(prepared.options)
  .then((handle) => {
    const publicUrl = effectivePublicUrl({ ...workspace, defaultPort: effectivePort });
    if (boot) {
      // `handle.url` is the LOCAL address (loopback or a concrete bindHost) —
      // the browser opens that, never `publicUrl`.
      const projectUrl = projectStartUrl(handle.url, boot.project.id);
      console.log(`\x1b[32m  claude4spec\x1b[0m  ready at \x1b[36m${projectUrl}\x1b[0m`);
      console.log(`  workspace: ${workspace.name}`);
      console.log(`  public url: ${publicUrl}`);
      console.log(`  cwd: ${cwd}`);
      const baseRoot = boot.config.roots.find((r) => r.builtin);
      console.log(`  pages: ${pagesDir ?? baseRoot?.dir ?? '(none)'}${baseRoot ? ` (root id: ${baseRoot.id})` : ''}`);
      console.log(`  config: ${boot.configPath}${boot.configCreated ? ' (created)' : ''}`);
      console.log(`  writing style: ${handle.writingStyle ? `${handle.writingStyle.title} (${handle.writingStyle.slug})` : 'none'}`);
      if (!noOpen && effectiveMode === 'prod') openBrowser(projectUrl);
    } else {
      // Workspace-only start (decision #11): nothing was written to the CWD;
      // a project is registered later via /welcome or the switcher.
      const welcomeUrl = `${handle.url}/welcome`;
      console.log(`\x1b[32m  claude4spec\x1b[0m  ready at \x1b[36m${welcomeUrl}\x1b[0m`);
      console.log(`  workspace: ${workspace.name} (workspace-only start — no project created)`);
      console.log(`  public url: ${publicUrl}`);
      console.log(`  hint: pass --create-project to register this directory as a project`);
      if (!noOpen && effectiveMode === 'prod') openBrowser(welcomeUrl);
    }
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

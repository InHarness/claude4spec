#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { startServer } from '../server/index.js';
import { migrateConfigToV3 } from '../server/config.js';
import { WorkspaceRegistry } from '../server/workspace/registry.js';
import { bootstrapProject } from '../server/workspace/bootstrap.js';
import {
  applyNetworkFlags,
  InvalidPublicUrlError,
} from '../server/workspace/network-flags.js';
import { effectiveBindHost, effectivePublicUrl } from '../core/workspace/network.js';
import type { WorkspaceRecord } from '../server/workspace/types.js';
import { parseLaunchArgs, printStartWarnings, workspaceOnlyLaunch } from './launch.js';

/**
 * M27 clone guard (step 6a). The target must be empty — no non-dotfile entries
 * and no pre-existing `.claude4spec/db.sqlite` — ignoring dotfiles and the fresh
 * `.claude4spec/` created during bootstrap. Runs BEFORE any remote call / DB open.
 * A pre-seeded `.claude4spec/config.json` (e.g. to set `remoteApiUrl` for a dev
 * peer) is a dotfile and is ignored.
 */
function assertCloneTargetEmpty(cwd: string): void {
  const dbPath = path.join(cwd, '.claude4spec', 'db.sqlite');
  const entries = fs.existsSync(cwd)
    ? fs.readdirSync(cwd).filter((name) => !name.startsWith('.'))
    : [];
  if (fs.existsSync(dbPath) || entries.length > 0) {
    console.error(
      `\x1b[31mCLONE_TARGET_NOT_EMPTY\x1b[0m — --clone requires an empty directory.\n` +
        `  cwd: ${cwd}\n` +
        `  Hint: mkdir <slug> && cd <slug> && npx @inharness-ai/claude4spec --clone <slug>`,
    );
    process.exit(1);
  }
}

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
const { port, cwd, pagesDir, mode, name, noOpen, clone, remoteUrl, createProject } = args;

const registry = new WorkspaceRegistry();

// 2.1.0: hash project ids → readable ids, BEFORE anything else touches the
// registry (writes refuse on an unmigrated file). Idempotent and resumable.
for (const r of registry.migrateIfNeeded()) {
  console.log(`  migrated project id ${r.from} → ${r.to} (workspace ${r.workspace})`);
}

/**
 * Persist `--host`/`--public-url` on the resolved workspace and print the
 * no-auth warning when it listens beyond loopback. An invalid `--public-url`
 * refuses the start before anything is written.
 */
function withNetwork(ws: WorkspaceRecord): WorkspaceRecord {
  let next: WorkspaceRecord;
  try {
    next = applyNetworkFlags(registry, ws, { host: args.host, publicUrl: args.publicUrl });
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

if (createProject) {
  // ── Create-project path (explicit opt-in or an implying flag) ──────────────
  fs.mkdirSync(cwd, { recursive: true });
  // M27 step 6a: validate the clone target is empty before any remote call / DB open.
  if (clone) assertCloneTargetEmpty(cwd);

  // M31: workspace select-or-create. Peek the config-v3 migration FIRST so a
  // pre-v3 `config.json.port` can still select the right workspace when no
  // --port/--workspace flag is given (first-wins carry happens in bootstrap).
  const peeked = migrateConfigToV3(cwd);
  const workspace = withNetwork(
    registry.selectOrCreate({
      name: args.workspace,
      port: port ?? peeked.carried.defaultPort,
      mode: mode ?? peeked.carried.mode,
    }),
  );

  // M31: full per-project activation (config, gitignore, welcome page,
  // registry registration, legacy-db relocation).
  const boot = bootstrapProject(registry, workspace, cwd, {
    name,
    pagesDir,
    remoteApiUrl: remoteUrl,
  });

  const effectivePort = port ?? workspace.defaultPort;
  const effectiveMode = mode ?? workspace.mode;

  startServer({
    cwd,
    workspace,
    createProject: true,
    port: effectivePort,
    host: effectiveBindHost(workspace),
    pagesDir,
    mode: effectiveMode,
    // Raw CLI --name only (undefined unless explicitly passed) — consumed solely as
    // the M27 clone name override, where an explicit --name wins over the bundle's
    // config.name.
    name,
    clone,
    // Resolved flag > config.json > null; startServer applies the prod-constant
    // fallback inside RemoteHttpClient.
    remoteApiUrl: boot.config.remoteApiUrl,
    // M27 (0.1.37): drive the clone full-rollback — delete config.json / .claude4spec/
    // only if THIS run created them.
    configCreated: boot.configCreated,
    claudeDirCreated: boot.claudeDirCreated,
    gitignoreCreated: boot.gitignoreCreated,
    systemRootDirsCreated: boot.systemRootDirsCreated,
  })
    .then((handle) => {
      // `handle.url` is the LOCAL address (loopback or a concrete bindHost) —
      // the browser opens that, never `publicUrl`.
      const projectUrl = `${handle.url}/p/${boot.project.id}/`;
      console.log(`\x1b[32m  claude4spec\x1b[0m  ready at \x1b[36m${projectUrl}\x1b[0m`);
      console.log(`  workspace: ${workspace.name}`);
      console.log(`  public url: ${effectivePublicUrl({ ...workspace, defaultPort: effectivePort })}`);
      console.log(`  cwd: ${cwd}`);
      const baseRoot = boot.config.roots.find((r) => r.builtin);
      console.log(`  pages: ${pagesDir ?? baseRoot?.dir ?? '(none)'}${baseRoot ? ` (root id: ${baseRoot.id})` : ''}`);
      console.log(`  config: ${boot.configPath}${boot.configCreated ? ' (created)' : ''}`);
      console.log(`  writing style: ${handle.writingStyle ? `${handle.writingStyle.title} (${handle.writingStyle.slug})` : 'none'}`);

      if (!noOpen && effectiveMode === 'prod') openBrowser(projectUrl);
      installShutdown(handle);
    })
    .catch(failToStart);
} else {
  // ── Workspace-only start (decision #11) ────────────────────────────────────
  // No mkdir, no config-v3 peek (it would rewrite config.json), no bootstrap —
  // nothing is written to the CWD. Select the workspace from CLI signals only
  // and open `/welcome`. A project is registered later via /welcome or the
  // switcher (POST /api/workspace/projects).
  const workspace = workspaceOnlyLaunch(registry, args, withNetwork);
  const effectivePort = port ?? workspace.defaultPort;
  const effectiveMode = mode ?? workspace.mode;

  startServer({
    cwd,
    workspace,
    createProject: false,
    port: effectivePort,
    host: effectiveBindHost(workspace),
    mode: effectiveMode,
  })
    .then((handle) => {
      const welcomeUrl = `${handle.url}/welcome`;
      console.log(`\x1b[32m  claude4spec\x1b[0m  ready at \x1b[36m${welcomeUrl}\x1b[0m`);
      console.log(`  workspace: ${workspace.name} (workspace-only start — no project created)`);
      console.log(`  public url: ${effectivePublicUrl({ ...workspace, defaultPort: effectivePort })}`);
      console.log(`  hint: pass --create-project to register this directory as a project`);

      if (!noOpen && effectiveMode === 'prod') openBrowser(welcomeUrl);
      installShutdown(handle);
    })
    .catch(failToStart);
}

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

#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { startServer } from '../server/index.js';
import { migrateConfigToV3 } from '../server/config.js';
import { WorkspaceRegistry } from '../server/workspace/registry.js';
import { bootstrapProject } from '../server/workspace/bootstrap.js';

interface CliArgs {
  port?: number;
  cwd: string;
  pagesDir?: string;
  mode?: 'dev' | 'prod';
  name?: string;
  /** M31: workspace selector (`--workspace <name>`); absent = port/default resolution. */
  workspace?: string;
  noOpen: boolean;
  /** M27: `--clone <slug>` — bootstrap-time clone of a published remote project. */
  clone?: string;
  /**
   * M01 (0.1.36): `--remote-url <url>` — sticky override of the remote
   * claude4spec-API base. Maps to config `remoteApiUrl`; persisted on first
   * bootstrap so later pushes/clones target the same remote.
   */
  remoteUrl?: string;
  /**
   * Decision #11 (0.1.57): `--create-project` — explicit opt-in to register the
   * CWD as a workspace project. Non-sticky (never written to config.json).
   * Implied by any per-project flag (`--cwd`/`--name`/`--pages`/`--clone`/
   * `--remote-url`). Without it the bare command is a workspace-only start that
   * writes nothing to the CWD and opens `/welcome`.
   */
  createProject: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    port: undefined,
    cwd: process.cwd(),
    pagesDir: undefined,
    mode: undefined,
    name: undefined,
    workspace: undefined,
    noOpen: false,
    clone: undefined,
    remoteUrl: undefined,
    createProject: false,
  };
  // `cwd` always defaults to process.cwd(), so its value can't signal intent —
  // track whether `--cwd` was passed explicitly to drive the create-project
  // implication.
  let cwdExplicit = false;
  const resolveCwd = (raw: string) => path.resolve(process.cwd(), raw);
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
    } else if (a === '--clone' && argv[i + 1]) {
      args.clone = argv[++i];
    } else if (a?.startsWith('--clone=')) {
      args.clone = a.split('=')[1];
    } else if (a === '--remote-url' && argv[i + 1]) {
      args.remoteUrl = argv[++i];
    } else if (a?.startsWith('--remote-url=')) {
      args.remoteUrl = a.split('=')[1];
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
    args.clone != null ||
    args.remoteUrl != null
  ) {
    args.createProject = true;
  }
  return args;
}

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

const args = parseArgs(process.argv.slice(2));
const { port, cwd, pagesDir, mode, name, noOpen, clone, remoteUrl, createProject } = args;

const registry = new WorkspaceRegistry();

if (createProject) {
  // ── Create-project path (explicit opt-in or an implying flag) ──────────────
  fs.mkdirSync(cwd, { recursive: true });
  // M27 step 6a: validate the clone target is empty before any remote call / DB open.
  if (clone) assertCloneTargetEmpty(cwd);

  // M31: workspace select-or-create. Peek the config-v3 migration FIRST so a
  // pre-v3 `config.json.port` can still select the right workspace when no
  // --port/--workspace flag is given (first-wins carry happens in bootstrap).
  const peeked = migrateConfigToV3(cwd);
  const workspace = registry.selectOrCreate({
    name: args.workspace,
    port: port ?? peeked.carried.defaultPort,
    mode: mode ?? peeked.carried.mode,
  });

  // M31: full per-project activation (config, gitignore, welcome page, skills,
  // mcp.json, registry registration, legacy-db relocation).
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
  })
    .then((handle) => {
      const projectUrl = `${handle.url}/p/${boot.project.id}/`;
      console.log(`\x1b[32m  claude4spec\x1b[0m  ready at \x1b[36m${projectUrl}\x1b[0m`);
      console.log(`  workspace: ${workspace.name}`);
      console.log(`  cwd: ${cwd}`);
      console.log(`  pages: ${pagesDir ?? boot.config.pagesDir}`);
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
  const workspace = registry.selectOrCreate({ name: args.workspace, port, mode });
  const effectivePort = port ?? workspace.defaultPort;
  const effectiveMode = mode ?? workspace.mode;

  startServer({
    cwd,
    workspace,
    createProject: false,
    port: effectivePort,
    mode: effectiveMode,
  })
    .then((handle) => {
      const welcomeUrl = `${handle.url}/welcome`;
      console.log(`\x1b[32m  claude4spec\x1b[0m  ready at \x1b[36m${welcomeUrl}\x1b[0m`);
      console.log(`  workspace: ${workspace.name} (workspace-only start — no project created)`);
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

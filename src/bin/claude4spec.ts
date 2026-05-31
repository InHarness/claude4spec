#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { startServer } from '../server/index.js';
import { BOOTSTRAP_TEMPLATE } from './bootstrap-template.js';
import { ensureExternalSkills } from '../server/external-skills/external-skills-service.js';
import { ensureMcpJson } from '../server/mcp/ensure-mcp-json.js';
import { loadOrCreateConfig } from '../server/config.js';
import { ensureGitignore } from './gitignore.js';

interface CliArgs {
  port?: number;
  cwd: string;
  pagesDir?: string;
  mode?: 'dev' | 'prod';
  name?: string;
  noOpen: boolean;
  /** M27: `--clone <slug>` — bootstrap-time clone of a published remote project. */
  clone?: string;
  /**
   * M01 (0.1.36): `--remote-url <url>` — sticky override of the remote
   * claude4spec-API base. Maps to config `remoteApiUrl`; persisted on first
   * bootstrap so later pushes/clones target the same remote.
   */
  remoteUrl?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    port: undefined,
    cwd: process.cwd(),
    pagesDir: undefined,
    mode: undefined,
    name: undefined,
    noOpen: false,
    clone: undefined,
    remoteUrl: undefined,
  };
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
    } else if (a?.startsWith('--cwd=')) {
      args.cwd = resolveCwd(a.split('=')[1]!);
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
    } else if (a === '--clone' && argv[i + 1]) {
      args.clone = argv[++i];
    } else if (a?.startsWith('--clone=')) {
      args.clone = a.split('=')[1];
    } else if (a === '--remote-url' && argv[i + 1]) {
      args.remoteUrl = argv[++i];
    } else if (a?.startsWith('--remote-url=')) {
      args.remoteUrl = a.split('=')[1];
    } else if (a === '--no-open') {
      args.noOpen = true;
    }
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

function ensureBootstrap(cwd: string, pagesDir: string | undefined): void {
  const pagesPath = path.join(cwd, pagesDir ?? 'pages');
  fs.mkdirSync(pagesPath, { recursive: true });
  const indexPath = path.join(pagesPath, 'index.md');
  if (fs.existsSync(indexPath)) return;
  const existing = fs.readdirSync(pagesPath).filter((name) => !name.startsWith('.'));
  if (existing.length > 0) return;
  fs.writeFileSync(indexPath, BOOTSTRAP_TEMPLATE, 'utf8');
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

const { port, cwd, pagesDir, mode, name, noOpen, clone, remoteUrl } = parseArgs(process.argv.slice(2));
fs.mkdirSync(cwd, { recursive: true });
// M27 step 6a: validate the clone target is empty before any remote call / DB open.
if (clone) assertCloneTargetEmpty(cwd);
// M27 (0.1.37): capture pre-bootstrap state for clone rollback — `.claude4spec/`
// is created lazily by loadOrCreateConfig/openDb, so check existence BEFORE it.
const claudeDirExisted = fs.existsSync(path.join(cwd, '.claude4spec'));
const { config: effective, created: configCreated, path: configFilePath } = loadOrCreateConfig(cwd, {
  name,
  port,
  pagesDir,
  mode,
  // M01 (0.1.36): `--remote-url` is sticky — persisted on first bootstrap, then
  // resolved (flag > config.json > prod constant) in startServer.
  remoteApiUrl: remoteUrl,
});
// M27 (0.1.37): capture whether .gitignore pre-existed BEFORE ensureGitignore —
// ensureGitignore creates it if absent, else only appends. Clone rollback deletes
// it only when this run created it (never a user's pre-existing .gitignore).
const gitignoreExisted = fs.existsSync(path.join(cwd, '.gitignore'));
ensureGitignore(cwd);
// When cloning, the restored pages/ populate the project — skip the welcome page
// (writing index.md first would also violate the empty-target precondition).
if (!clone) ensureBootstrap(cwd, effective.pagesDir);
ensureExternalSkills(cwd);
ensureMcpJson({ projectAbsPath: cwd });

startServer({
  cwd,
  port: effective.port,
  pagesDir: effective.pagesDir,
  mode: effective.mode,
  // Raw CLI --name only (undefined unless explicitly passed) — consumed solely as
  // the M27 clone name override, where an explicit --name wins over the bundle's
  // config.name. effective.name (cwd-basename default) must NOT shadow it.
  name,
  clone,
  // Resolved flag > config.json > null; startServer applies the prod-constant
  // fallback inside RemoteHttpClient.
  remoteApiUrl: effective.remoteApiUrl,
  // M27 (0.1.37): drive the clone full-rollback — delete config.json / .claude4spec/
  // only if THIS run created them (step 3 created the dir iff it didn't pre-exist).
  configCreated,
  claudeDirCreated: !claudeDirExisted,
  gitignoreCreated: !gitignoreExisted,
})
  .then((handle) => {
    console.log(`\x1b[32m  claude4spec\x1b[0m  ready at \x1b[36m${handle.url}\x1b[0m`);
    console.log(`  cwd: ${cwd}`);
    console.log(`  pages: ${effective.pagesDir}`);
    console.log(`  config: ${configFilePath}${configCreated ? ' (created)' : ''}`);
    console.log(`  writing style: ${handle.writingStyle ? `${handle.writingStyle.title} (${handle.writingStyle.slug})` : 'none'}`);

    if (!noOpen && effective.mode === 'prod') openBrowser(handle.url);

    const close = async () => {
      console.log('\n  shutting down…');
      await handle.shutdown();
      process.exit(0);
    };
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
  })
  .catch((err) => {
    console.error('failed to start:', err);
    process.exit(1);
  });

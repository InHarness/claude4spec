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
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    port: undefined,
    cwd: process.cwd(),
    pagesDir: undefined,
    mode: undefined,
    name: undefined,
    noOpen: false,
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
    } else if (a === '--no-open') {
      args.noOpen = true;
    }
  }
  return args;
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

const { port, cwd, pagesDir, mode, name, noOpen } = parseArgs(process.argv.slice(2));
fs.mkdirSync(cwd, { recursive: true });
const { config: effective, created: configCreated, path: configFilePath } = loadOrCreateConfig(cwd, {
  name,
  port,
  pagesDir,
  mode,
});
ensureGitignore(cwd);
ensureBootstrap(cwd, effective.pagesDir);
ensureExternalSkills(cwd);
ensureMcpJson({ projectAbsPath: cwd });

startServer({
  cwd,
  port: effective.port,
  pagesDir: effective.pagesDir,
  mode: effective.mode,
  name: effective.name,
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

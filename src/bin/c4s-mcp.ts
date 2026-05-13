#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openDbReadonly, ReadonlyDbError } from '../server/db/readonly.js';
import { RawEntityReader } from '../server/domain/raw-entity-reader.js';
import { serializationEngine } from '../server/core/plugin-host/serialization-engine.js';
import '../server/serialization/registerAll.js';
import { createC4sReaderServer } from '../server/mcp/c4s-reader.js';
import { resolveProject } from './c4s/project.js';
import { CliError } from './c4s/errors.js';

interface CliArgs {
  project?: string;
  help: boolean;
  version: boolean;
}

const HELP = `Usage: c4s-mcp [options]

Standalone stdio MCP server exposing readonly access to a claude4spec project.

Options:
  --project <path>  Path to the claude4spec project (default: walk-up from cwd)
  --help            Show this help
  --version         Print version

Register in your editor's MCP config (e.g. .mcp.json):

  {
    "mcpServers": {
      "c4s-reader": {
        "command": "c4s-mcp",
        "args": ["--project", "/path/to/spec"]
      }
    }
  }
`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--project' && argv[i + 1]) args.project = argv[++i];
    else if (a?.startsWith('--project=')) args.project = a.split('=')[1];
  }
  return args;
}

function readPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, '..', 'package.json'),
      path.resolve(here, '..', '..', 'package.json'),
    ];
    for (const pkgPath of candidates) {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
        if (pkg.version) return pkg.version;
      }
    }
  } catch {
    /* ignore */
  }
  return '0.0.0';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const version = readPackageVersion();

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.version) {
    process.stdout.write(`c4s-mcp ${version}\n`);
    return;
  }

  let projectDir: string | null = null;
  let reader: RawEntityReader | null = null;
  let db: import('better-sqlite3').Database | null = null;
  let close: (() => void) | null = null;

  try {
    projectDir = resolveProject(args.project);
    const opened = openDbReadonly(projectDir);
    db = opened.handle;
    close = opened.close;
    reader = new RawEntityReader(db);
    process.stderr.write(`c4s-mcp ${version} ready (project: ${projectDir})\n`);
  } catch (err) {
    const code = err instanceof CliError || err instanceof ReadonlyDbError ? err.code : 'PROJECT_NOT_FOUND';
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `c4s-mcp ${version} started without a project (${code}: ${message})\n` +
        `tools will return errors until --project is provided\n`,
    );
  }

  const { server } = createC4sReaderServer({
    reader,
    registry: serializationEngine,
    db,
    projectDir,
    packageVersion: version,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    if (close) close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`c4s-mcp fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

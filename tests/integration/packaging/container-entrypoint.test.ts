/**
 * 2.1.63 (M01 `uxlvmu4n`, `mcdkzcb6`, `f2ob9gtq`): the Docker image starts
 * only through `docker/entrypoint.sh`, driven by PORT / PUBLIC_URL /
 * REMOTE_API_URL / PROJECT_DIR, and registers PROJECT_DIR as a workspace
 * project, retrying until it succeeds.
 *
 * No Docker here: the script is spawned with bash from a scratch "app"
 * directory whose `dist/bin/claude4spec.js` is a stub server. The stub records
 * the argv the entrypoint started it with, listens on the `--port` it was
 * given and answers `POST /api/workspace/projects`, recording every request.
 * So what is asserted is what the real server would receive — its flags and
 * the registration requests — not the text of the script.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseLaunchArgs } from '../../../src/bin/launch.js';
import { effectiveRemoteUrl } from '../../../src/server/services/remote-http-client.js';

const REPO_ROOT = path.join(import.meta.dirname, '../../..');
const ENTRYPOINT = path.join(REPO_ROOT, 'docker/entrypoint.sh');
const DOCKERFILE = path.join(REPO_ROOT, 'docker/Dockerfile');

/**
 * The stub server (CommonJS: the scratch app has its own package.json).
 * - STUB_RECORD: JSON-lines file, one `{argv}` line at start, one
 *   `{request, body, status}` line per registration request;
 * - STUB_LISTEN_DELAY_MS: wait before listening (registration before listen);
 * - STUB_FAIL_FIRST: answer that many registrations with 503 first;
 * - STUB_REFUSE: answer every registration with this status;
 * - STUB_NO_LISTEN: never listen (argv-only cases on a fixed port).
 */
const STUB_SERVER = `
const fs = require('node:fs');
const http = require('node:http');
const record = (entry) => fs.appendFileSync(process.env.STUB_RECORD, JSON.stringify(entry) + '\\n');
const argv = process.argv.slice(2);
record({ argv, pid: process.pid });
const port = Number(argv[argv.indexOf('--port') + 1]);
let failFirst = Number(process.env.STUB_FAIL_FIRST || 0);
let n = 0;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/api/workspace/projects') {
      res.writeHead(404).end();
      return;
    }
    n += 1;
    let status = 201;
    if (process.env.STUB_REFUSE) status = Number(process.env.STUB_REFUSE);
    else if (failFirst > 0) { failFirst -= 1; status = 503; }
    record({ request: n, body: JSON.parse(raw), status });
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(status === 201 ? { projectId: 'p1' } : { error: { code: 'X' } }));
  });
});
const keepAlive = setInterval(() => {}, 60_000);
process.on('SIGTERM', () => { clearInterval(keepAlive); server.close(); process.exit(0); });
if (!process.env.STUB_NO_LISTEN) {
  setTimeout(() => server.listen(port, '127.0.0.1'), Number(process.env.STUB_LISTEN_DELAY_MS || 0));
}
`;

/** A stub `mkdir` (first on PATH) for the default `/workspace/project`, which cannot be created here. */
const STUB_MKDIR = `#!/usr/bin/env bash
echo "$@" >> "$STUB_MKDIR_RECORD"
`;

/**
 * A stub `node` (first on PATH) for the default-port case, which cannot use a
 * free port: the entrypoint's registration call (`node -e …`) is recorded with
 * the PORT it targets and answered as a success without any network traffic,
 * so the test never talks to whatever listens on 127.0.0.1:3000. Every other
 * invocation (the server start) runs the real node.
 */
const STUB_NODE = `#!/usr/bin/env bash
if [ "\${1:-}" = "-e" ]; then
  echo "\${PORT:-}" >> "$STUB_NODE_RECORD"
  exit 0
fi
exec "$STUB_REAL_NODE" "$@"
`;

interface StartRecord {
  argv?: string[];
  pid?: number;
  request?: number;
  body?: { cwd?: string };
  status?: number;
}

let scratch: string;
let appDir: string;
let recordPath: string;
let child: ChildProcess | undefined;
let exited: Promise<number | null> | undefined;

function readRecords(): StartRecord[] {
  if (!fs.existsSync(recordPath)) return [];
  return fs
    .readFileSync(recordPath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as StartRecord);
}

async function waitFor<T>(probe: () => T | undefined, what: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; records: ${JSON.stringify(readRecords())}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/** Runs the entrypoint as the container would, with exactly `env` (plus PATH/HOME and the stub's knobs). */
function startContainer(env: Record<string, string>, extraPath?: string): void {
  child = spawn('bash', [ENTRYPOINT], {
    cwd: appDir,
    env: {
      PATH: extraPath ? `${extraPath}${path.delimiter}${process.env.PATH ?? ''}` : (process.env.PATH ?? ''),
      HOME: scratch,
      STUB_RECORD: recordPath,
      ...env,
    },
    stdio: 'ignore',
  });
  const proc = child;
  exited = new Promise((resolve) => proc.once('exit', (code) => resolve(code)));
}

async function startArgv(env: Record<string, string>, extraPath?: string): Promise<string[]> {
  startContainer(env, extraPath);
  return waitFor(() => readRecords().find((r) => r.argv)?.argv, 'the server start');
}

/** The value following `flag` in the server argv, or undefined when the flag is absent. */
function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

async function stillRunningAfter(ms: number): Promise<boolean> {
  const result = await Promise.race([exited!.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), ms))]);
  return result;
}

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-entrypoint-'));
  appDir = path.join(scratch, 'app');
  fs.mkdirSync(path.join(appDir, 'dist/bin'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  fs.writeFileSync(path.join(appDir, 'dist/bin/claude4spec.js'), STUB_SERVER);
  recordPath = path.join(scratch, 'record.jsonl');
});

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
  }
  // Safety net: a stub server must never outlive its test.
  for (const r of readRecords()) {
    if (r.pid) {
      try {
        process.kill(r.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
  child = undefined;
  exited = undefined;
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('container entrypoint — environment contract (M01 mcdkzcb6)', () => {
  it('[ac:ac-kontener-uruchomiony-z-port-startuje] PORT becomes --port and the server listens on that port', async () => {
    const port = await freePort();
    const projectDir = path.join(scratch, 'project');
    startContainer({ PORT: String(port), PROJECT_DIR: projectDir });

    const argv = await waitFor(() => readRecords().find((r) => r.argv)?.argv, 'the server start');
    expect(flagValue(argv, '--port')).toBe(String(port));
    // The registration reached the server on 127.0.0.1:<PORT> — it listens there.
    const registered = await waitFor(() => readRecords().find((r) => r.status === 201), 'a registration on PORT');
    expect(registered.body?.cwd).toBe(projectDir);
  });

  it('[section:mcdkzcb6] an unset or empty PORT starts with --port 3000', async () => {
    // Port 3000 may belong to a real app here: the stub server does not listen
    // and the registration call never leaves the stubbed `node`.
    const binDir = path.join(scratch, 'bin');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'node'), STUB_NODE, { mode: 0o755 });
    for (const env of [{}, { PORT: '' }] as Record<string, string>[]) {
      const nodeRecord = path.join(scratch, 'node.log');
      const argv = await startArgv(
        {
          ...env,
          PROJECT_DIR: path.join(scratch, 'project'),
          STUB_NO_LISTEN: '1',
          STUB_REAL_NODE: process.execPath,
          STUB_NODE_RECORD: nodeRecord,
        },
        binDir,
      );
      expect(flagValue(argv, '--port'), JSON.stringify(env)).toBe('3000');
      // The registration targets the same default port.
      const ports = await waitFor(
        () => (fs.existsSync(nodeRecord) ? fs.readFileSync(nodeRecord, 'utf-8').trim() || undefined : undefined),
        'the registration call',
      );
      expect(ports.split('\n'), JSON.stringify(env)).toEqual(['3000']);
      child!.kill('SIGTERM');
      await exited;
      fs.rmSync(recordPath, { force: true });
      fs.rmSync(nodeRecord, { force: true });
    }
  });

  it('[ac:ac-kontener-uruchomiony-z-ustawiona-publ] a set PUBLIC_URL starts the server with --public-url equal to it', async () => {
    const port = await freePort();
    const argv = await startArgv({
      PORT: String(port),
      PROJECT_DIR: path.join(scratch, 'project'),
      PUBLIC_URL: 'https://spec.example.test:8443',
    });
    expect(flagValue(argv, '--public-url')).toBe('https://spec.example.test:8443');
    expect(argv.filter((a) => a.startsWith('--public-url'))).toHaveLength(1);
  });

  it('[ac:ac-kontener-uruchomiony-bez-public-url-s] without PUBLIC_URL (unset or empty) the server starts without --public-url', async () => {
    for (const env of [{}, { PUBLIC_URL: '' }] as Record<string, string>[]) {
      const port = await freePort();
      const argv = await startArgv({ ...env, PORT: String(port), PROJECT_DIR: path.join(scratch, 'project') });
      expect(argv.some((a) => a.startsWith('--public-url')), JSON.stringify(env)).toBe(false);
      child!.kill('SIGTERM');
      await exited;
      fs.rmSync(recordPath, { force: true });
    }
  });

  it('[ac:ac-kontener-uruchomiony-z-ustawiona-remo] a set REMOTE_API_URL starts the server with --remote-url equal to it', async () => {
    const port = await freePort();
    const argv = await startArgv({
      PORT: String(port),
      PROJECT_DIR: path.join(scratch, 'project'),
      REMOTE_API_URL: 'https://remote.example.test/api',
    });
    expect(flagValue(argv, '--remote-url')).toBe('https://remote.example.test/api');
    expect(argv.filter((a) => a.startsWith('--remote-url'))).toHaveLength(1);
  });

  it('[ac:ac-kontener-uruchomiony-bez-remote-api-u] without REMOTE_API_URL the server starts without --remote-url', async () => {
    const port = await freePort();
    const argv = await startArgv({ PORT: String(port), PROJECT_DIR: path.join(scratch, 'project') });
    expect(argv.some((a) => a.startsWith('--remote-url'))).toBe(false);
    // So the owner's value applies: config.remoteApiUrl, then the production address.
    const parsed = parseLaunchArgs(argv, appDir);
    expect(parsed.remoteUrl).toBeUndefined();
    expect(effectiveRemoteUrl(parsed.remoteUrl, 'https://configured.example.test')).toBe('https://configured.example.test');
  });

  it('[ac:ac-remote-api-url-ustawiona-na-pusty-cia] REMOTE_API_URL set to an empty string starts without --remote-url (never an empty flag)', async () => {
    const port = await freePort();
    const argv = await startArgv({ PORT: String(port), PROJECT_DIR: path.join(scratch, 'project'), REMOTE_API_URL: '' });
    expect(argv.some((a) => a.startsWith('--remote-url'))).toBe(false);
    expect(argv).not.toContain('');
  });

  it('[ac:ac-kontener-z-ustawiona-remote-api-url-k] REMOTE_API_URL routes remote API traffic to its address without overriding the entrypoint', async () => {
    // 1. The image starts through the entrypoint script, with no CMD to override.
    const dockerfile = fs.readFileSync(DOCKERFILE, 'utf-8');
    expect(dockerfile).toMatch(/^COPY docker\/entrypoint\.sh \/usr\/local\/bin\/entrypoint\.sh$/m);
    expect(dockerfile).toMatch(/^ENTRYPOINT \["\/usr\/local\/bin\/entrypoint\.sh"\]$/m);
    expect(dockerfile).not.toMatch(/^CMD\b/m);

    // 2. With only the variable set, the server's effective remote base is its address,
    //    ahead of a different config.remoteApiUrl.
    const port = await freePort();
    const argv = await startArgv({
      PORT: String(port),
      PROJECT_DIR: path.join(scratch, 'project'),
      REMOTE_API_URL: 'https://remote.example.test',
    });
    const parsed = parseLaunchArgs(argv, appDir);
    expect(parsed.remoteUrl).toBe('https://remote.example.test');
    expect(effectiveRemoteUrl(parsed.remoteUrl, 'https://configured.example.test')).toBe('https://remote.example.test');
  });

  it('[section:3zqke46q] a syntactically invalid REMOTE_API_URL reaches the server as --remote-url and is refused by its validation', async () => {
    const port = await freePort();
    const argv = await startArgv({ PORT: String(port), PROJECT_DIR: path.join(scratch, 'project'), REMOTE_API_URL: 'not a url' });
    expect(flagValue(argv, '--remote-url')).toBe('not a url');
    expect(() => parseLaunchArgs(argv, appDir)).toThrow(/--remote-url/);
  });

  it('[section:mcdkzcb6] an unset or empty PROJECT_DIR registers /workspace/project', async () => {
    // `/workspace` cannot be created outside a container: `mkdir` is stubbed.
    const binDir = path.join(scratch, 'bin');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'mkdir'), STUB_MKDIR, { mode: 0o755 });
    for (const env of [{}, { PROJECT_DIR: '' }] as Record<string, string>[]) {
      const mkdirRecord = path.join(scratch, 'mkdir.log');
      const port = await freePort();
      startContainer({ ...env, PORT: String(port), STUB_MKDIR_RECORD: mkdirRecord }, binDir);
      const registered = await waitFor(() => readRecords().find((r) => r.status === 201), 'a registration');
      expect(registered.body?.cwd, JSON.stringify(env)).toBe('/workspace/project');
      expect(fs.readFileSync(mkdirRecord, 'utf-8')).toContain('/workspace/project');
      child!.kill('SIGTERM');
      await exited;
      fs.rmSync(recordPath, { force: true });
      fs.rmSync(mkdirRecord, { force: true });
    }
  });
});

describe('container entrypoint — the process start (M01 uxlvmu4n, f2ob9gtq)', () => {
  it('[section:uxlvmu4n] starts without workspace selectors, on every interface, with no browser, in prod', async () => {
    const port = await freePort();
    const argv = await startArgv({ PORT: String(port), PROJECT_DIR: path.join(scratch, 'project') });
    expect(argv.some((a) => a.startsWith('--cwd') || a.startsWith('--workspace'))).toBe(false);
    expect(flagValue(argv, '--host')).toBe('0.0.0.0');
    expect(argv).toContain('--no-open');
    expect(flagValue(argv, '--mode')).toBe('prod');
  });

  it('[section:f2ob9gtq] --mode has no variable: the start is prod whatever the environment says', async () => {
    const port = await freePort();
    const argv = await startArgv({
      PORT: String(port),
      PROJECT_DIR: path.join(scratch, 'project'),
      MODE: 'dev',
      C4S_MODE: 'dev',
    });
    expect(argv.filter((a) => a === '--mode')).toHaveLength(1);
    expect(flagValue(argv, '--mode')).toBe('prod');
  });
});

describe('container entrypoint — project registration (M01 uxlvmu4n, 3zqke46q)', () => {
  it('[ac:ac-po-starcie-kontenera-katalog-wskazany] PROJECT_DIR is registered as a workspace project, retried until it succeeds, also before the server listens', async () => {
    const port = await freePort();
    const projectDir = path.join(scratch, 'my project');
    // The server listens only after 1.5 s and first answers 503: the entrypoint
    // keeps retrying through both, with no synchronisation of the two.
    startContainer({
      PORT: String(port),
      PROJECT_DIR: projectDir,
      STUB_LISTEN_DELAY_MS: '1500',
      STUB_FAIL_FIRST: '1',
    });

    const registered = await waitFor(() => readRecords().find((r) => r.status === 201), 'a successful registration');
    expect(registered.body).toEqual({ cwd: projectDir });
    const requests = readRecords().filter((r) => r.request !== undefined);
    expect(requests.map((r) => r.status)).toEqual([503, 201]);
    expect(fs.statSync(projectDir).isDirectory()).toBe(true);

    // Registration done: the container keeps serving, it does not register again.
    expect(await stillRunningAfter(1_000)).toBe(true);
    expect(readRecords().filter((r) => r.request !== undefined)).toHaveLength(2);

    // A stop is forwarded to the server, which shuts down cleanly.
    child!.kill('SIGTERM');
    expect(await exited).toBe(0);
  });

  it('a registration the server refuses with a 4xx ends the container (ASSUMPTION:dev-0002)', async () => {
    const port = await freePort();
    startContainer({ PORT: String(port), PROJECT_DIR: path.join(scratch, 'project'), STUB_REFUSE: '400' });
    expect(await exited).toBe(1);
    expect(readRecords().filter((r) => r.request !== undefined)).toHaveLength(1);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BRIDGE = path.join(REPO_ROOT, 'dist/bin/c4s-mcp.js');

/**
 * 0.2.13 §3 — `c4s-mcp` against an unreachable mount point.
 *
 * Over the BUILT bin rather than the source, because the defect this pins was
 * invisible in the source: `StreamableHTTPClientTransport.start()` is lazy, so
 * the original `try { await http.start() }` reported success against a dead
 * port and the failure surfaced only when the client's `initialize` went
 * unanswered — a hang, from the client's side. Every assertion here is about
 * behaviour a reader of the file would have got wrong.
 */
describe('c4s-mcp against an unreachable server', () => {
  const run = async (args: string[]): Promise<{ code: number; stderr: string; stdout: string }> => {
    try {
      const { stdout, stderr } = await pexec('node', [BRIDGE, ...args], { timeout: 20000 });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  };

  it('exits 8 and names both the server and the configured mount', async () => {
    // Port 59999 is closed; "reachable" must mean a TCP answer, not a lazy
    // transport reporting that it intends to connect later.
    const res = await run(['--url', 'http://127.0.0.1:59999/api/projects/x/mcp']);
    expect(res.code).toBe(8);
    expect(res.stderr).toMatch(/cannot reach/i);
    // The ORIGIN is what was probed and what is absent...
    expect(res.stderr).toContain('http://127.0.0.1:59999');
    // ...and the configured mount, so a typo in the path is still visible.
    expect(res.stderr).toContain('/api/projects/x/mcp');
  }, 30000);

  it('says it will not start a server, because it never does', async () => {
    const res = await run(['--url', 'http://127.0.0.1:59999/api/projects/x/mcp']);
    expect(res.stderr).toMatch(/never starts one/i);
  }, 30000);

  it('requires --url — a bridge with no address has nothing to bridge to', async () => {
    const res = await run([]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('--url is required');
  }, 30000);

  it('rejects a malformed --url before opening anything', async () => {
    const res = await run(['--url', 'not-a-url']);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/not a valid URL/i);
  }, 30000);

  it('NAMES the retired flags when it is launched as a pre-0.2.13 stdio entry', async () => {
    /**
     * The upgrade rewrites `<project>/.claude4spec/mcp.json`, which is the only
     * copy it can reach. A user who followed the old `--help` into their own
     * editor config — `~/.claude/mcp.json`, a repo-root `.mcp.json`, a Cursor or
     * VS Code entry — keeps launching the bridge with the old flags after
     * upgrading, and the editor surfaces only "failed to start".
     *
     * "--url is required" is true and useless there: it does not say the flags
     * were retired, what replaced them, or how to obtain the URL. This is the
     * one failure mode where the message IS the fix.
     */
    const res = await run(['--project', '/abs/spec', '--workspace', 'default']);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('--project');
    expect(res.stderr).toContain('--workspace');
    expect(res.stderr).toMatch(/removed in 0\.2\.13/);
    // Where the working address comes from, in both forms a user can act on.
    expect(res.stderr).toContain('--url');
    expect(res.stderr).toContain('.claude4spec/mcp.json');
  }, 30000);

  it('still says only "--url is required" when nothing at all was passed', async () => {
    // The retired-flag diagnosis must not swallow the ordinary one — an empty
    // command line is a different mistake and gets the general help.
    const res = await run([]);
    expect(res.stderr).toContain('--url is required');
    expect(res.stderr).not.toMatch(/removed in 0\.2\.13/);
  }, 30000);
});

/**
 * Bridge lifecycle, against a REAL listening server.
 *
 * Both defects here were invisible in the source and only appear when the
 * process actually runs: `close()` fires its own `onclose` synchronously, and
 * stdin EOF is silent unless something is listening for it.
 */
describe('c4s-mcp lifecycle against a live server', () => {
  let server: http.Server;
  let mount: string;

  beforeAll(async () => {
    // A stub that answers /api/health and nothing else — reachability is all the
    // bridge probes, and standing up a full project context here would test the
    // server rather than the bridge.
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/api/health')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    mount = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/p/mcp`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const spawnBridge = (after: (p: ReturnType<typeof spawn>) => void) =>
    new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const p = spawn('node', [BRIDGE, '--url', mount], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      p.on('exit', (code) => resolve({ code, stderr }));
      setTimeout(() => after(p), 800);
    });

  it('exits 0 on SIGINT, without reporting a crash', async () => {
    // `http.close()` fires `onclose` synchronously, which used to re-enter the
    // shutdown path and exit 1 with "closed the connection" — so every Ctrl-C
    // looked like a crash to a supervising client, which may restart in a loop.
    const res = await spawnBridge((p) => p.kill('SIGINT'));
    expect(res.code).toBe(0);
    expect(res.stderr).not.toMatch(/closed the connection/);
  }, 30000);

  it('exits when its client goes away, instead of orphaning itself', async () => {
    // stdin EOF is how every MCP client ends a stdio server. With nothing
    // subscribed, the open HTTP transport kept the event loop alive and one
    // process leaked per editor restart.
    const res = await spawnBridge((p) => p.stdin?.end());
    expect(res.code).toBe(0);
  }, 30000);

  it('accepts a server that answers health but not the mount', async () => {
    // 404 on the mount means the SERVER is there; whether this mount exists is
    // its answer to give at the protocol level, on a connection that stays open.
    // Probing the mount itself forced a ProjectContext build, so a cold project
    // was reported as "no server, start one" while the server was up.
    const res = await spawnBridge((p) => p.kill('SIGINT'));
    expect(res.code).toBe(0);
    expect(res.stderr).toMatch(/bridging stdio to/);
  }, 30000);
});

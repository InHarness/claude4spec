import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
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

  it('exits 8 and names the mount point rather than hanging', async () => {
    // Port 59999 is closed; "reachable" must mean a TCP answer, not a lazy
    // transport reporting that it intends to connect later.
    const res = await run(['--url', 'http://127.0.0.1:59999/api/projects/x/mcp']);
    expect(res.code).toBe(8);
    expect(res.stderr).toContain('http://127.0.0.1:59999/api/projects/x/mcp');
    expect(res.stderr).toMatch(/cannot reach/i);
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
});

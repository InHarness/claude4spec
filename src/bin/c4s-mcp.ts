#!/usr/bin/env node
/**
 * `c4s-mcp` — a stdio↔HTTP bridge, and nothing else.
 *
 * ## What this used to be
 *
 * A standalone MCP server: it resolved a workspace, opened the project's SQLite
 * slot `readonly: true`, built a serialization engine and a discovery core, and
 * served fourteen tools over stdio. That made it a SECOND execution locus for
 * operations the server process also implemented — the drift this release
 * exists to remove.
 *
 * ## What it is now
 *
 * A relay. It forwards MCP protocol frames between stdio and a mount point in
 * the server process and carries no semantics of its own: it does not map calls
 * onto REST routes, does not know which operations exist, and never touches a
 * database. Every question about scope is answered on the other end by the
 * connection's context profile.
 *
 * It exists ONLY for clients that cannot speak HTTP. The generated
 * `.claude4spec/mcp.json` no longer points here — it declares the HTTP mount
 * directly.
 *
 * ## Two things it deliberately does not do
 *
 * **It never starts a server.** An unreachable mount point is reported as
 * exactly that. Starting one in the background would put a second, unsupervised
 * server process on the machine, and falling back to local execution would
 * restore the very second locus this rewrite removed.
 *
 * **It has no project selector.** The project is written into the mount address
 * (`/api/projects/<id>/mcp`), so "started without a project" stopped being a
 * concept — there is no state in which the bridge is running but unaddressed. A
 * wrong `:id` segment answers `PROJECT_NOT_IN_WORKSPACE` from the server, at the
 * protocol level, on a connection that stays open.
 *
 * The old invariant "never ends the process" (stdio EOF) becomes "never ends the
 * connection" (HTTP disconnect): a transport error is reported and the bridge
 * keeps relaying rather than exiting under the client.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { readPackageVersion } from './c4s/package-version.js';

interface CliArgs {
  url?: string;
  help: boolean;
  version: boolean;
}

const HELP = `Usage: c4s-mcp --url <mount-url>

Bridges an MCP client that speaks stdio to a claude4spec server's MCP mount
point over HTTP. It carries protocol frames and nothing else — the operation
set, the profile and every error come from the server.

Options:
  --url <url>   Mount point to bridge to. Required. One of:
                  http://127.0.0.1:<port>/api/projects/<projectId>/mcp
                  http://127.0.0.1:<port>/api/workspace/mcp?project=<slug>
                Append ?profile=chat|ask|brief|patch to pick a context profile
                (default: chat). The profile is fixed for the connection.
  --help        Show this help
  --version     Print version

Prefer a native HTTP entry if your client supports one — that is what
.claude4spec/mcp.json generates, and this bridge is only for clients that do
not. The server must already be running: this command never starts one.
`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--url' && argv[i + 1]) args.url = argv[++i];
    else if (a?.startsWith('--url=')) args.url = a.slice('--url='.length);
  }
  return args;
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

  if (!args.url) {
    // The old `--project`/`--workspace` pair is gone: a bridge with no address
    // has nothing to bridge to, so this is fatal rather than a degraded start.
    process.stderr.write(`c4s-mcp: --url is required (mount point to bridge to)\n\n${HELP}`);
    process.exit(2);
  }

  let mount: URL;
  try {
    mount = new URL(args.url);
  } catch {
    process.stderr.write(`c4s-mcp: --url is not a valid URL: ${args.url}\n`);
    process.exit(2);
    return;
  }

  const stdio = new StdioServerTransport();
  const http = new StreamableHTTPClientTransport(mount);

  /**
   * The relay itself. Each side's `onmessage` hands the frame to the other's
   * `send` unread — no inspection, no rewriting, no knowledge of method names.
   * That is the whole contract: anything this file understood about a frame
   * would be semantics living in two places.
   */
  stdio.onmessage = (msg: JSONRPCMessage) => {
    void http.send(msg).catch((err: unknown) => {
      // Report and keep relaying. Exiting here would hand the client an EOF
      // where it needed a diagnosis — the same failure the old degraded-start
      // path existed to avoid, in its new transport.
      process.stderr.write(`c4s-mcp: send to ${mount.href} failed: ${describe(err)}\n`);
    });
  };
  http.onmessage = (msg: JSONRPCMessage) => {
    void stdio.send(msg).catch((err: unknown) => {
      process.stderr.write(`c4s-mcp: write to stdout failed: ${describe(err)}\n`);
    });
  };

  stdio.onerror = (err) => process.stderr.write(`c4s-mcp: stdio error: ${describe(err)}\n`);
  http.onerror = (err) => process.stderr.write(`c4s-mcp: transport error: ${describe(err)}\n`);
  // A closed HTTP side leaves the client talking into a bridge with no far end,
  // so the process ends rather than silently swallowing every later frame.
  http.onclose = () => {
    process.stderr.write(`c4s-mcp: ${mount.href} closed the connection\n`);
    process.exit(1);
  };

  /**
   * Reachability is probed explicitly, before any relaying.
   *
   * `StreamableHTTPClientTransport.start()` is lazy — it does not open a
   * connection, so wrapping it in a try/catch reports success against a dead
   * port and the failure only surfaces when the client's `initialize` goes
   * unanswered. From the client's side that is a hang, which is precisely the
   * diagnosis-shaped failure this bridge is supposed to avoid.
   *
   * Any HTTP RESPONSE means reachable, including 404 or 405: the server is
   * there, and whether this particular mount point exists is the server's
   * answer to give at the protocol level. Only a transport-level failure —
   * ECONNREFUSED, DNS, timeout — means "no server".
   */
  try {
    await fetch(mount.href, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping', params: {} }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    process.stderr.write(
      `c4s-mcp: cannot reach the MCP mount point at ${mount.href} (${describe(err)})\n` +
        `Start the claude4spec server first — this bridge never starts one.\n`,
    );
    process.exit(8);
  }
  await http.start();
  await stdio.start();
  process.stderr.write(`c4s-mcp ${version} bridging stdio to ${mount.href}\n`);

  const shutdown = (): void => {
    void http.close();
    void stdio.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main().catch((err) => {
  process.stderr.write(`c4s-mcp fatal: ${describe(err)}\n`);
  process.exit(1);
});

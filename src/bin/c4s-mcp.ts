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
  /** Pre-0.2.13 flags seen on the command line — see {@link RETIRED_FLAGS}. */
  retired: string[];
}

/**
 * How long the liveness probe waits for the server to answer `/api/health`.
 *
 * Generous, because the only thing it decides is "is a server there at all",
 * and being wrong about that costs the user a failed MCP entry with advice to
 * start something that is already running. Project build time does not enter
 * into it — `/api/health` is a workspace route that touches no project.
 */
const HEALTH_PROBE_MS = 10_000;

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

/**
 * Flags this command took before 0.2.13, kept only to be NAMED in the refusal.
 *
 * The upgrade rewrites `<project>/.claude4spec/mcp.json`, and that is the only
 * copy it can reach. Anyone who followed the old `--help` into their editor's own
 * config — `~/.claude/mcp.json`, a repo-root `.mcp.json`, a Cursor or VS Code
 * settings entry — still launches the bridge with `--project <abs> --workspace
 * <name>` after upgrading. Dropping those silently produced a refusal that named
 * `--url` and nothing else: true, and useless, because it does not say the flags
 * were retired, what replaced them, or how to build the URL. The editor reports
 * only "failed to start", and the user's spec-reader is gone for the session.
 */
const RETIRED_FLAGS = ['--project', '--workspace'];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false, version: false, retired: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--url' && argv[i + 1]) args.url = argv[++i];
    else if (a?.startsWith('--url=')) args.url = a.slice('--url='.length);
    else {
      const retired = RETIRED_FLAGS.find((f) => a === f || a?.startsWith(`${f}=`));
      if (retired) {
        args.retired.push(retired);
        // Consume the value of a space-separated form so it is not re-read as
        // another flag.
        if (a === retired && argv[i + 1] && !argv[i + 1]!.startsWith('--')) i++;
      }
    }
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
    // When those flags are what we were given, say so — that is the diagnosis,
    // and it is not derivable from "--url is required".
    if (args.retired.length > 0) {
      process.stderr.write(
        `c4s-mcp: ${args.retired.join(' and ')} ${args.retired.length > 1 ? 'were' : 'was'} removed in 0.2.13 — this is a stdio MCP entry from an older version.\n\n` +
          'The MCP surface now lives in the server process, so the bridge takes the mount URL instead of a project to open:\n\n' +
          '  c4s-mcp --url http://127.0.0.1:<port>/api/projects/<projectId>/mcp?profile=ask\n\n' +
          "Your project's current entry — URL included — is regenerated at every server start in\n" +
          '<project>/.claude4spec/mcp.json; copy the `url` from there, or point your client at that file.\n' +
          'Better still, use a native HTTP entry if your client supports one; this bridge is only for clients that do not.\n',
      );
      process.exit(2);
    }
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

  /**
   * One shutdown path, and a flag so a deliberate stop is not reported as a
   * crash.
   *
   * `close()` on either transport fires its own `onclose` SYNCHRONOUSLY, so the
   * signal handler calling `http.close()` used to re-enter the handler below,
   * write "closed the connection" and `process.exit(1)` — before `stdio.close()`
   * and before the intended `exit(0)`. Every Ctrl-C produced a spurious error
   * line and a non-zero code, which a supervising client reads as a crash and
   * may restart in a loop.
   */
  let stopping = false;
  const stop = (code: number, reason?: string): never => {
    if (reason) process.stderr.write(`c4s-mcp: ${reason}\n`);
    stopping = true;
    void http.close();
    void stdio.close();
    process.exit(code);
  };

  // A closed HTTP side leaves the client talking into a bridge with no far end,
  // so the process ends rather than silently swallowing every later frame.
  http.onclose = () => {
    if (stopping) return;
    stop(1, `${mount.href} closed the connection`);
  };

  /**
   * The other half of "never ends the connection": stdin EOF.
   *
   * This is how every MCP client ends a stdio server — quitting the editor,
   * reloading the window. Without a handler the open HTTP transport keeps the
   * event loop alive, so the process stays resident forever holding a server-side
   * session, and one orphan accumulates per editor restart. Ending here is not
   * the failure the header warns about: the client that needed the diagnosis is
   * the one that just went away.
   */
  stdio.onclose = () => {
    if (stopping) return;
    stopping = true;
    void http.close();
    process.exit(0);
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
   * The probe asks whether a SERVER is there, and nothing else:
   *
   *   - It hits `/api/health`, a workspace-level route, rather than the mount.
   *     A POST to the mount runs `projectDispatchMiddleware` — plugin load,
   *     migrations, index materialisation — so on a cold or large project a
   *     running server routinely took longer than the timeout and was reported
   *     as absent, telling the user to start something already running.
   *   - Any HTTP RESPONSE means reachable, including 404 or 405. Whether this
   *     particular mount exists is the server's answer to give at the protocol
   *     level, on a connection that stays open.
   *   - Only a transport-level failure — ECONNREFUSED, DNS, timeout — means
   *     "no server", and that is the only case that exits.
   */
  const health = new URL('/api/health', mount);
  try {
    await fetch(health.href, { signal: AbortSignal.timeout(HEALTH_PROBE_MS) });
  } catch (err) {
    // Names the ORIGIN, because that is what was probed and what is absent —
    // and the configured mount too, so a typo in the path is still visible to
    // whoever has to fix the config.
    process.stderr.write(
      `c4s-mcp: cannot reach a claude4spec server at ${mount.origin} (${describe(err)})\n` +
        `  configured mount: ${mount.href}\n` +
        `Start the claude4spec server first — this bridge never starts one.\n`,
    );
    process.exit(8);
  }
  await http.start();
  await stdio.start();
  process.stderr.write(`c4s-mcp ${version} bridging stdio to ${mount.href}\n`);

  // Both signals go through the one shutdown path, which sets `stopping` first
  // so the transports' own `onclose` callbacks do not re-enter it and turn a
  // deliberate stop into exit 1.
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main().catch((err) => {
  process.stderr.write(`c4s-mcp fatal: ${describe(err)}\n`);
  process.exit(1);
});

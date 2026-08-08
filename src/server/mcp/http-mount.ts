/**
 * MCP over HTTP — the transport half of the external surface.
 *
 * `surface.ts` decides WHAT a connection can reach; this file is how the
 * protocol gets to it. The two are separate because the surface has to be
 * recomposed under a connection that outlives the `ProjectContext` it was first
 * composed from.
 *
 * ## A connection is not a turn
 *
 * The single most important property here, and the one most likely to be broken
 * later by someone adding a reasonable-looking line. An open MCP connection:
 *
 *   - does NOT raise `hasInFlightTurn()`, so it never blocks a purge or a
 *     config reload;
 *   - does NOT pin the `ProjectContext` against LRU eviction;
 *   - does NOT count toward the `maxLive` budget.
 *
 * An editor left open overnight with `c4s-spec-reader` configured would
 * otherwise hold a project live forever. The context is resolved per REQUEST,
 * through the normal cache, so a call arriving after an eviction rebuilds and
 * answers the operation — it does not fail the connection.
 *
 * ## Sessions outlive contexts, so tools are re-bound not re-created
 *
 * The session registry is process-wide and keyed by MCP session id. Tool
 * IDENTITY (name, description, schema) is registered once on the session's
 * `McpServer`; the HANDLER dispatches through `session.current`, a map refreshed
 * from the live context before every request reaches the transport. That is what
 * "the context is rebuilt lazily at `tools/call`" means in code.
 *
 * `tools/list_changed` is sent only when the name set actually differs — a plugin
 * activated or deactivated. A plain rebuild of the same pool changes nothing the
 * client can observe, and notifying on it would train clients to ignore the
 * notification.
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShape } from 'zod';
import type { ChatContextType } from '../../shared/entities.js';
import { KNOWN_PROFILES } from '../operations/profiles.js';
import { toolError } from '../operations/envelope.js';
import type { McpToolDeclaration } from '../../shared/plugin-host/mcp.js';
import { composeExternalSurface, EXTERNAL_MCP_SERVER_NAME, type ExternalSurface, type ExternalSurfaceDeps } from './surface.js';

/** Package version reported in the MCP handshake. */
export interface McpMountOptions {
  packageVersion: string;
  /**
   * Resolve the surface deps for THIS request. Called per request, never
   * cached by the mount — caching belongs to `ProjectContextCache`, which
   * already knows when a context is stale.
   *
   * Returning `null` means the request named no resolvable project; the mount
   * answers a protocol-level error rather than composing an empty surface.
   */
  resolve: (req: Request) => Promise<ExternalSurfaceDeps | null>;
  /**
   * What this request is bound to — the project id, or the `?project=` selector.
   * Compared against the session's pinned value so a later request cannot
   * re-point an established session at a different project.
   */
  binding: (req: Request) => string;
}

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  /** Fixed at initialize, immutable for the connection's life. */
  profile: ChatContextType;
  /**
   * The binding target fixed at initialize — the project id for the
   * project-bound mount, the `?project=` selector for the workspace-bound one.
   *
   * Pinned for the same reason the profile is. A client holding a session id can
   * put whatever it likes in a later request's query string, and without this a
   * request could carry an established session's header with a DIFFERENT
   * `?project=` and have the tool set swapped under it. The connection would
   * then be reading one specification while its handshake said another.
   */
  binding: string;
  /** Refreshed before every request — what the handlers dispatch through. */
  current: ExternalSurface;
  registered: Map<string, RegisteredTool>;
  /** Epoch ms of the last request on this session — input to the idle reaper. */
  lastSeen: number;
}

/**
 * How long a session survives with no request before it is reaped.
 *
 * A reaper is necessary rather than tidy. `DELETE` is the protocol's way to end
 * a session, but nothing forces a client to send it: an editor that is quit, a
 * laptop that sleeps, a crashed process — all leave the session behind, and
 * unlike stdio there is no pipe whose EOF tells us. Without this, an entry (and
 * the tool registry hanging off it) accumulates per connection for the life of
 * the server process.
 *
 * Reaping a session costs the client one reconnect, which the transport already
 * handles: `SESSION_NOT_FOUND` is exactly the signal to re-initialize.
 */
export const MCP_SESSION_IDLE_MS = 30 * 60 * 1000;

/**
 * Process-wide, deliberately: a session must survive the eviction and rebuild of
 * the `ProjectContext` it was opened against. Keying it on anything derived from
 * a context would tie the connection's life to the context's, which is the
 * coupling this whole design exists to avoid.
 */
const SESSIONS = new Map<string, Session>();

/** Test seam — the registry is module state, so a suite needs a way to reset it. */
export function __resetMcpSessions(): void {
  for (const s of SESSIONS.values()) void s.transport.close();
  SESSIONS.clear();
}

export function activeMcpSessionCount(): number {
  return SESSIONS.size;
}

/**
 * Test seam: backdate every session's `lastSeen`, so a suite can reproduce a
 * genuinely idle connection without waiting half an hour or stubbing the clock.
 */
export function ageAllMcpSessions(byMs: number): void {
  for (const session of SESSIONS.values()) session.lastSeen -= byMs;
}

/**
 * Drop sessions idle past {@link MCP_SESSION_IDLE_MS}.
 *
 * Swept on each incoming request rather than on a timer: a process with no MCP
 * traffic has nothing to reap, and a timer would be one more thing keeping the
 * event loop alive. `now` is a parameter so a test can age sessions without
 * waiting half an hour.
 */
export function reapIdleMcpSessions(now = Date.now()): number {
  let reaped = 0;
  for (const [id, session] of SESSIONS) {
    if (now - session.lastSeen < MCP_SESSION_IDLE_MS) continue;
    SESSIONS.delete(id);
    void session.transport.close();
    reaped++;
  }
  return reaped;
}

/**
 * Which profile this connection runs under.
 *
 * The brief fixes the default (`chat`) and the immutability, but not how a
 * client names one — so this is the host's choice: a `?profile=` query parameter
 * on the mount URL, read once at initialize. A bad value is rejected outright
 * rather than silently downgraded to `chat`: silently widening a caller who
 * asked to be narrow is the wrong direction to fail in.
 */
export function profileFromRequest(req: Request): { ok: true; profile: ChatContextType } | { ok: false; message: string } {
  const raw = req.query.profile;
  if (raw === undefined) return { ok: true, profile: 'chat' };
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !KNOWN_PROFILES.includes(value as ChatContextType)) {
    return {
      ok: false,
      message: `unknown profile '${String(value)}'; expected one of ${KNOWN_PROFILES.join(', ')}`,
    };
  }
  return { ok: true, profile: value as ChatContextType };
}

function jsonRpcError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code: -32000, message, data: { code } },
    id: null,
  });
}

/**
 * Re-bind a session's tools to the freshly resolved context.
 *
 * Identity registered once; handlers always dispatch through `session.current`,
 * which this replaces. Only a genuine change in the NAME SET touches the
 * `McpServer`'s registry, and only that sends `tools/list_changed`.
 */
function syncTools(session: Session, surface: ExternalSurface): void {
  const before = session.current.toolNames;
  session.current = surface;

  const wanted = new Set(surface.toolNames);
  let changed = false;

  for (const [name, handle] of session.registered) {
    if (wanted.has(name)) continue;
    handle.remove();
    session.registered.delete(name);
    changed = true;
  }

  for (const decl of surface.tools) {
    if (session.registered.has(decl.name)) continue;
    session.registered.set(decl.name, registerOne(session, decl));
    changed = true;
  }

  // Belt and braces: `registerTool`/`remove` already notify a connected server,
  // but the diff above is the only thing that should ever trigger it, and the
  // equality check states that intent in a way a future refactor has to notice.
  if (changed && before.join('\0') !== surface.toolNames.join('\0')) {
    session.server.sendToolListChanged();
  }
}

function registerOne(session: Session, decl: McpToolDeclaration): RegisteredTool {
  /**
   * Read off `decl` HERE, so the handler closes over a string and not over the
   * declaration.
   *
   * The dispatch below was already written to avoid calling `decl.handler` — the
   * comment says why — but capturing `decl` to read `decl.name` kept the whole
   * declaration alive for the session's lifetime, and `decl.handler` closes over
   * the `ProjectContext` that was live at first registration: its db handle, its
   * plugin host, its indexes. So the context could be evicted and disposed and
   * still never be collected, and a long-lived editor connection leaked one whole
   * context per eviction — defeating the LRU budget this mount's own header
   * claims a connection does not consume. Reaching for one field of an object is
   * enough to retain all of it.
   */
  const name = decl.name;
  const description = decl.description;
  const inputSchema = decl.inputSchema as ZodRawShape;

  return session.server.registerTool(
    name,
    { description, inputSchema },
    // Dispatches through `session.current`, NOT through `decl` — `decl`'s handler
    // closes over the context that was live when this tool was first registered,
    // and that context may since have been disposed.
    (async (args: Record<string, unknown>, extra: unknown) => {
      const live = session.current.byName.get(name);
      if (!live) {
        return toolError(
          'NOT_FOUND',
          `tool '${name}' is no longer available on this connection`,
          'the plugin pool changed; call tools/list again',
        );
      }
      return live.handler(args, extra);
    }) as never,
  );
}

/**
 * The express handler for one mount point. Handles POST (client→server), GET
 * (server→client SSE) and DELETE (session teardown) — the three verbs the
 * Streamable HTTP transport defines.
 */
export function mcpRequestHandler(opts: McpMountOptions) {
  return async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? SESSIONS.get(sessionId) : undefined;
    /**
     * Touch BEFORE sweeping.
     *
     * The sweep used to run first, which meant a request arriving on a session
     * idle past the window reaped the very session it was addressed to and then
     * answered `SESSION_NOT_FOUND` — so a client whose request cadence is slower
     * than the window could never reuse a session at all, and the editor case
     * this reaper exists for was exactly the one it broke. A request IS activity;
     * the session is not idle at the moment it is being used.
     */
    if (existing) existing.lastSeen = Date.now();
    reapIdleMcpSessions();

    /**
     * The binding is checked BEFORE the project is resolved, deliberately.
     *
     * Resolving first would answer a mismatched request by whether the OTHER
     * project happens to exist — 400 when it does, 404 when it does not — so a
     * caller holding a session bound elsewhere could enumerate the workspace one
     * guess at a time. Checking the pin first makes the refusal depend only on
     * the session, which is the only thing this request is entitled to be told
     * about.
     */
    if (existing && opts.binding(req) !== existing.binding) {
      jsonRpcError(
        res,
        400,
        'VALIDATION',
        `this session is bound to '${existing.binding}'; open a new connection to reach a different project`,
      );
      return;
    }

    let deps: ExternalSurfaceDeps | null;
    try {
      deps = await opts.resolve(req);
    } catch (err) {
      // A failed context build is this project's problem, not the process's —
      // the middleware's own 15s failure cache keeps it from becoming a storm.
      jsonRpcError(res, 500, 'PROJECT_BUILD_FAILED', err instanceof Error ? err.message : String(err));
      return;
    }
    if (!deps) {
      jsonRpcError(res, 404, 'PROJECT_NOT_IN_WORKSPACE', 'no project resolvable for this mount point');
      return;
    }

    if (existing) {
      // The profile is pinned too: `deps.profile` is whatever the resolver
      // produced from this request's query, and the session's own value wins.
      syncTools(existing, composeExternalSurface({ ...deps, profile: existing.profile }));
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }

    if (typeof sessionId === 'string') {
      jsonRpcError(res, 404, 'SESSION_NOT_FOUND', `unknown MCP session '${sessionId}'`);
      return;
    }

    const chosen = profileFromRequest(req);
    if (!chosen.ok) {
      jsonRpcError(res, 400, 'VALIDATION', chosen.message);
      return;
    }

    const server = new McpServer(
      { name: EXTERNAL_MCP_SERVER_NAME, version: opts.packageVersion },
      { capabilities: { tools: { listChanged: true } } },
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        SESSIONS.set(id, session);
      },
      onsessionclosed: (id) => {
        SESSIONS.delete(id);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) SESSIONS.delete(transport.sessionId);
    };

    const session: Session = {
      server,
      transport,
      profile: chosen.profile,
      binding: opts.binding(req),
      current: { tools: [], byName: new Map(), toolNames: [] },
      registered: new Map(),
      lastSeen: Date.now(),
    };

    // Registered BEFORE connect, so the initial set is the handshake's answer
    // rather than a change notification the client cannot have subscribed to yet.
    syncTools(session, composeExternalSurface({ ...deps, profile: chosen.profile }));
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
}

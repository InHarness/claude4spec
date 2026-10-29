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
 *   - does NOT raise `hasInFlightTurn()`, so it never holds back the release
 *     of a context — a detach, a purge, an invalidation's predecessor
 *     (M31 `xocjjal4`, M12 `reys7qo4`).
 *
 * An editor left open overnight with `c4s-spec-reader` configured would
 * otherwise hold a stale or removed context forever. The context is resolved
 * per REQUEST, through the normal cache: a `tools/call` arriving while an
 * invalidation's rebuild runs waits for the successor — the same path a REST
 * request takes — and answers the operation from it, without failing the
 * connection. A call on a project detached meanwhile is refused as a project
 * outside the workspace (`PROJECT_NOT_IN_WORKSPACE`).
 *
 * ## Sessions outlive contexts, so tools are re-bound not re-created
 *
 * The session registry is process-wide and keyed by MCP session id. Tool
 * IDENTITY (name, description, schema) is registered once on the session's
 * `McpServer`; the HANDLER dispatches through `session.current`, a map refreshed
 * from the live context before every request reaches the transport — so a call
 * after a rebuild dispatches into the successor context, never the released one.
 * When a context is released, the map of every session still holding its surface
 * is emptied (`releaseMcpSessionSurfaces`), so an idle connection keeps no
 * handler of it — and a session already re-synced to the successor keeps its own.
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
import { isMcpChannelProfile, MCP_CHANNEL_PROFILE_NAMES } from '../operations/profiles.js';
import { toolError } from '../operations/envelope.js';
import type { McpToolDeclaration } from '../../shared/plugin-host/mcp.js';
import { EXTERNAL_MCP_SERVER_NAME, type ExternalSurface } from './surface.js';

/** Package version reported in the MCP handshake. */
export interface McpMountOptions {
  packageVersion: string;
  /**
   * Resolve the surface for THIS request, under `profile` — the session's pinned
   * one on an established session, the handshake's otherwise. Called per
   * request, never cached by the mount — caching belongs to
   * `ProjectContextCache`, which already knows when a context is stale.
   *
   * Returning `null` means the request named no resolvable project; the mount
   * answers a protocol-level error rather than composing an empty surface. A
   * throw is a failed context build (`500 PROJECT_BUILD_FAILED`).
   *
   * The mount takes a SURFACE rather than deps because the two mounts render
   * one differently: the project-bound one composes its project's surface, the
   * workspace-bound one re-renders a template with a per-call `project`
   * argument (`bindProjectPerCall`). `previous` is the established session's
   * current surface (absent on a handshake), for a resolver that would rather
   * keep it than degrade it.
   */
  surface: (req: Request, profile: ChatContextType, previous?: ExternalSurface) => Promise<ExternalSurface | null>;
  /**
   * What this request is bound to — `project:<id>` on the project-bound mount,
   * the workspace (plus the `?project=` compat default, if any) on the
   * workspace-bound one. Compared against the session's pinned value so a later
   * request cannot re-point an established session at a different binding.
   */
  binding: (req: Request) => string;
  /**
   * 2.1.0: message of the 404 PROJECT_NOT_IN_WORKSPACE answered when `resolve`
   * returns `null` — the workspace-bound mount lists the available ids there
   * (ids only, never directories).
   */
  notFoundMessage?: (req: Request) => string;
  /**
   * Opaque identity of what this mount's surfaces are composed from — set by the
   * project-bound mount, one token per context. A session remembers the token of
   * the surface it holds, so a release names exactly the sessions still holding
   * THAT context's handlers ({@link releaseMcpSessionSurfaces}). A token, never
   * the context itself: the session must not keep what it identifies reachable.
   */
  owner?: symbol;
}

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  /** Fixed at initialize, immutable for the connection's life. */
  profile: ChatContextType;
  /**
   * The binding target fixed at initialize — the project id for the
   * project-bound mount, the workspace for the workspace-bound one (whose calls
   * name their project per call).
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
  /** The {@link McpMountOptions.owner} of the mount that composed `current`. */
  owner: symbol | undefined;
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
 * Process-wide, deliberately: a session must survive the release and rebuild of
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
 * Let go of the surface composed by `owner` that sessions bound to `binding`
 * still hold — called when the context behind `owner` is released (carried U6
 * rev-0001).
 *
 * `session.current` is refreshed before every request, so between requests it
 * still holds the LAST context's handlers — and through them that context's db
 * handle, plugin host and indexes. An idle connection (an editor left open) would
 * keep a released context reachable until its next request or the idle reap:
 * one whole context per idle session, which a repeated rebuild of the project
 * must not leave behind (M31 `m31ctx001`, open question #67).
 *
 * Only the handlers go; the advertised NAME set stays, so the next request's
 * re-sync compares against what the client was told and sends
 * `tools/list_changed` only on a real pool change. No call can reach the emptied
 * map: every request re-syncs from the live context before the transport
 * dispatches it.
 *
 * Only a session whose surface `owner` composed: a retired context is disposed
 * late — once its last turn ends — when its successor is already serving and a
 * session may have re-synced to it. Emptying that session would take the
 * SUCCESSOR's handlers from a call already past its re-sync, which then answers
 * NOT_FOUND for a tool the live context has.
 */
export function releaseMcpSessionSurfaces(binding: string, owner: symbol): void {
  for (const session of SESSIONS.values()) {
    if (session.binding !== binding || session.owner !== owner) continue;
    session.current = { tools: [], byName: new Map(), toolNames: session.current.toolNames, scopeByName: new Map() };
  }
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
 *
 * 2.1.26 (M12 `ecawzsbr`): "known" means a row of the channel's CLOSED table
 * (`MCP_CHANNEL_PROFILES`), not a value of the context-type registry. A value
 * the registry knows and the table does not is refused here, at connection
 * set-up, before any catalog is exposed — it gets no default branch.
 */
export function profileFromRequest(req: Request): { ok: true; profile: ChatContextType } | { ok: false; message: string } {
  const raw = req.query.profile;
  if (raw === undefined) return { ok: true, profile: 'chat' };
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !isMcpChannelProfile(value)) {
    return {
      ok: false,
      message: `unknown profile '${String(value)}'; expected one of ${MCP_CHANNEL_PROFILE_NAMES.join(', ')}`,
    };
  }
  return { ok: true, profile: value };
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
function syncTools(session: Session, surface: ExternalSurface, owner: symbol | undefined): void {
  const before = session.current.toolNames;
  session.current = surface;
  session.owner = owner;

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
   * plugin host, its indexes. So the context could be retired and disposed and
   * still never be collected, and a long-lived editor connection leaked one whole
   * context per rebuild — the very retention this mount's own header claims a
   * connection does not cause. Reaching for one field of an object is enough to
   * retain all of it.
   */
  const name = decl.name;
  const description = decl.description;
  const inputSchema = decl.inputSchema as ZodRawShape;
  const annotations = decl.annotations;

  return session.server.registerTool(
    name,
    { description, inputSchema, ...(annotations ? { annotations } : {}) },
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
 * The standalone GET stream (server→client notifications) lives as long as the
 * connection — it is the one request an idle session keeps open. Served so that
 * it holds nothing of the context the request was routed through (carried U6
 * rev-0001):
 *
 *   - NOT awaited by the mount's handler: a pending frame of that handler would
 *     keep its options alive, and the project-bound mount's options close over
 *     the context it was built in;
 *   - with the router state express leaves on the request cleared — `req.next`
 *     (the per-context router's continuation) and `req.route` (the route whose
 *     stack holds that same handler). The handler never calls `next`, so nothing
 *     reads them after this point.
 *
 * Module-level on purpose: a closure here would capture the options this
 * function exists to let go of.
 */
function serveStandaloneStream(transport: StreamableHTTPServerTransport, req: Request, res: Response): void {
  const routed = req as Request & { next?: unknown; route?: unknown };
  routed.next = undefined;
  routed.route = undefined;
  transport.handleRequest(req, res).catch((err: unknown) => {
    if (!res.headersSent) jsonRpcError(res, 500, 'INTERNAL', err instanceof Error ? err.message : String(err));
  });
}

/**
 * A new session's server, transport and registry entry — built here, at module
 * level, and NOT inline in the mount's request handler (carried U6 rev-0001).
 *
 * The transport keeps its callbacks (`onsessioninitialized`, `onsessionclosed`,
 * `onclose`) for the session's whole life, and a closure keeps its ENTIRE scope
 * chain, not just the variables it names: created inside the handler, they held
 * the handler's scope and, one level up, the mount's `opts` — whose `surface`
 * resolver on the project-bound mount closes over the context the mount was built
 * in. So every session kept the context it was OPENED on reachable for its life,
 * whatever `releaseMcpSessionSurfaces` emptied: one released context per idle
 * connection. Here the callbacks' scope is this function's — three plain values
 * and the session itself.
 */
function openSession(packageVersion: string, profile: ChatContextType, binding: string): Session {
  const server = new McpServer(
    { name: EXTERNAL_MCP_SERVER_NAME, version: packageVersion },
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
    profile,
    binding,
    current: { tools: [], byName: new Map(), toolNames: [], scopeByName: new Map() },
    owner: undefined,
    registered: new Map(),
    lastSeen: Date.now(),
  };
  return session;
}

/**
 * The express handler for one mount point. Handles POST (client→server), GET
 * (server→client SSE) and DELETE (session teardown) — the three verbs the
 * Streamable HTTP transport defines.
 */
export function mcpRequestHandler(opts: McpMountOptions) {
  const handle = mcpRequestHandlerUnguarded(opts);
  /**
   * Nothing thrown while serving one MCP request may leave this function.
   * Express 4 does not catch a rejected async handler, so an escaped throw is an
   * unhandled rejection and takes the whole server process down — one bad tool
   * schema once turned a single `initialize` into an outage for every project.
   */
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await handle(req, res);
    } catch (err) {
      if (!res.headersSent) jsonRpcError(res, 500, 'INTERNAL', err instanceof Error ? err.message : String(err));
    }
  };
}

function mcpRequestHandlerUnguarded(opts: McpMountOptions) {
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

    // The profile is pinned: on an established session its own value wins over
    // whatever this request's query says. On a handshake a bad value is refused
    // below, after the project — the order the mount has always answered in.
    const chosen = existing ? ({ ok: true, profile: existing.profile } as const) : profileFromRequest(req);

    let surface: ExternalSurface | null;
    try {
      surface = await opts.surface(req, chosen.ok ? chosen.profile : 'chat', existing?.current);
    } catch (err) {
      // A failed context build is this project's problem, not the process's —
      // the middleware's own 15s failure cache keeps it from becoming a storm.
      jsonRpcError(res, 500, 'PROJECT_BUILD_FAILED', err instanceof Error ? err.message : String(err));
      return;
    }
    if (!surface) {
      jsonRpcError(
        res,
        404,
        'PROJECT_NOT_IN_WORKSPACE',
        opts.notFoundMessage?.(req) ?? 'no project resolvable for this mount point',
      );
      return;
    }

    if (existing) {
      syncTools(existing, surface, opts.owner);
      if (req.method === 'GET') {
        serveStandaloneStream(existing.transport, req, res);
        return;
      }
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }

    if (typeof sessionId === 'string') {
      jsonRpcError(res, 404, 'SESSION_NOT_FOUND', `unknown MCP session '${sessionId}'`);
      return;
    }

    if (!chosen.ok) {
      jsonRpcError(res, 400, 'VALIDATION', chosen.message);
      return;
    }

    const session = openSession(opts.packageVersion, chosen.profile, opts.binding(req));

    // Registered BEFORE connect, so the initial set is the handshake's answer
    // rather than a change notification the client cannot have subscribed to yet.
    syncTools(session, surface, opts.owner);
    await session.server.connect(session.transport);
    await session.transport.handleRequest(req, res, req.body);
  };
}

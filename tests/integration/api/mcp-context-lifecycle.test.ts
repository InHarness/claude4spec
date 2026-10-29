import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import v8 from 'node:v8';
import { runInNewContext } from 'node:vm';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { projectMcpRouter, workspaceMcpRouter } from '../../../src/server/routes/mcp.js';
import { __resetMcpSessions } from '../../../src/server/mcp/http-mount.js';
import { createMcpServer, mcpTool } from '../../../src/server/plugin-runtime/index.js';
import { ProjectContextCache } from '../../../src/server/workspace/context-cache.js';
import { projectDispatchMiddleware } from '../../../src/server/workspace/middleware.js';
import type { ProjectContext } from '../../../src/server/workspace/project-context.js';
import type { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import type { ProjectRecord, WorkspaceRecord } from '../../../src/server/workspace/types.js';
import type { ExternalSurfaceDeps } from '../../../src/server/mcp/surface.js';
import type { McpServerFactory } from '../../../src/shared/plugin-host/mcp.js';
import type { ChatContextType } from '../../../src/shared/entities.js';

/**
 * 2.1.60 — an open MCP connection against the context lifecycle of the build
 * queue (M31 `xocjjal4`, M12 `reys7qo4`, `kl277elf`).
 *
 * A REAL `ProjectContextCache` (its queue, invalidation and release are the
 * thing under test), the REAL transport middleware and both REAL mounts, and a
 * real MCP client over HTTP. Only the context is a stand-in: each build is a
 * numbered GENERATION serving the harness's MCP surface, with its own plugin
 * host identity (so the surface is recomposed per generation, as for a real
 * rebuild) and a `list_projects` answer that names the generation — the
 * observable of "which context answered". `hasInFlightTurn` is the production
 * predicate: the size of the context's agent-turn registry.
 */
describe('MCP connection vs. the context lifecycle', () => {
  let app: TestApp;
  let server: http.Server;
  let base: string;
  let cache: ProjectContextCache;
  let workspace: WorkspaceRecord;
  const open: Client[] = [];

  interface Generation {
    projectId: string;
    gen: number;
    disposed: boolean;
    activeAdapters: Map<string, unknown>;
    /** The generation's plugin host — reachable only through its context and the surfaces composed from it. */
    host: WeakRef<object>;
  }
  let generations: Generation[] = [];
  let counter = 0;
  /** While set, every build waits for it — a rebuild "in progress". */
  let gate: Promise<void> | null = null;
  let releaseGate: (() => void) | null = null;
  /** When true, the next builds carry one more plugin (a real pool change). */
  let poolChanged = false;

  const ofProject = (id: string) => generations.filter((g) => g.projectId === id);

  /**
   * A plugin of the changed pool: its own server with one tool. Test-only
   * names — the base plugins installed where the suite runs (e.g. spreadsheets'
   * `set_cell`) must not already carry them, so the change is provably new.
   */
  const PROBE_TYPE = 'c4s-test-pool-probe';
  const PROBE_TOOL = 'c4s_test_pool_probe';
  const probeServer = () => ({
    name: `${PROBE_TYPE}-tools`,
    server: createMcpServer({
      name: `${PROBE_TYPE}-tools`,
      tools: [mcpTool(PROBE_TOOL, 'test-only pool probe', { x: z.string().optional() }, async () => ({ content: [] }))],
    }) as unknown as McpServerFactory,
  });

  /** A per-generation host: same plugins as the harness, plus the changed pool when asked. */
  const hostFor = (withPlugin: boolean): ExternalSurfaceDeps['pluginHost'] =>
    ({
      buildMcpServers: (o?: { include?: (name: string) => boolean }) => [
        ...app.host.buildMcpServers(o),
        ...(withPlugin ? [probeServer()].filter((s) => !o?.include || o.include(s.name)) : []),
      ],
      listEntities: () => [...app.host.listEntities(), ...(withPlugin ? [{ type: PROBE_TYPE }] : [])],
    }) as unknown as ExternalSurfaceDeps['pluginHost'];

  const build = async (project: ProjectRecord): Promise<ProjectContext> => {
    if (gate) await gate;
    const host = hostFor(poolChanged);
    const record: Generation = {
      projectId: project.id,
      gen: ++counter,
      disposed: false,
      activeAdapters: new Map(),
      host: new WeakRef(host as object),
    };
    generations.push(record);
    const surfaceDeps = (profile: ChatContextType): ExternalSurfaceDeps => ({
      ...app.mcpSurfaceDeps(profile),
      pluginHost: host,
      listProjects: () => ({ workspace: 'default', projects: [{ id: project.id, name: `generation-${record.gen}` }] }),
    });
    const router = express.Router();
    const mcp = projectMcpRouter('0.0.0-test', project.id, surfaceDeps);
    router.use('/mcp', mcp);
    return {
      projectId: project.id,
      cwd: app.cwd,
      mcpSurfaceDeps: surfaceDeps,
      router,
      hasInFlightTurn: () => record.activeAdapters.size > 0,
      dispose: async () => {
        record.disposed = true;
        // The step of the real context's dispose (`buildProjectContext`) under test here.
        mcp.releaseSurfaces();
      },
    } as unknown as ProjectContext;
  };

  const holdBuilds = () => {
    gate = new Promise<void>((resolve) => (releaseGate = resolve));
  };
  const releaseBuilds = () => {
    releaseGate?.();
    gate = null;
    releaseGate = null;
  };

  /** The registry's detach, then the cache's — what DELETE /workspace/projects/:id does. */
  const detach = (id: string) => {
    workspace = { ...workspace, projects: workspace.projects.filter((p) => p.id !== id) };
    cache.remove(id);
  };

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => {
    app.cleanup();
  });

  beforeEach(async () => {
    generations = [];
    counter = 0;
    poolChanged = false;
    workspace = {
      name: 'default',
      mode: 'prod',
      defaultPort: 4500,
      projects: [
        // `other` first: the workspace mount's template is the first project,
        // so a call naming `app-spec` resolves it per call.
        { id: 'other', cwd: app.cwd, name: 'other', addedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'app-spec', cwd: app.cwd, name: 'app-spec', addedAt: '2026-01-01T00:00:00.000Z' },
      ],
    } as unknown as WorkspaceRecord;
    const registry = {
      getWorkspace: () => workspace,
      getProject: (_ws: WorkspaceRecord, id: string) => workspace.projects.find((p) => p.id === id) ?? null,
    } as unknown as WorkspaceRegistry;
    cache = new ProjectContextCache(build);

    const expressApp = express();
    expressApp.use(express.json({ limit: '2mb' }));
    expressApp.use(
      '/api/workspace/mcp',
      workspaceMcpRouter({ registry, workspace, cache, packageVersion: '0.0.0-test' }) as express.Router,
    );
    expressApp.use('/api/projects/:id', projectDispatchMiddleware(registry, workspace, cache));
    server = http.createServer(expressApp);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    releaseBuilds(); // a held build would keep `disposeAll` waiting for it
    for (const c of open.splice(0)) await c.close().catch(() => {});
    __resetMcpSessions();
    await cache.disposeAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function connect(
    url: string,
    onListChanged?: () => void,
  ): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
    const client = new Client({ name: 'test', version: '0.0.0' });
    if (onListChanged) client.setNotificationHandler(ToolListChangedNotificationSchema, () => onListChanged());
    const transport = new StreamableHTTPClientTransport(new URL(url));
    await client.connect(transport);
    open.push(client);
    return { client, transport };
  }

  const toolsCall = (url: string, sessionId: string, name: string, args: Record<string, unknown> = {}) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }),
    });

  type Result = { isError?: boolean; content: Array<{ type: string; text: string }> };
  const text = (r: unknown) => JSON.stringify((r as Result).content);
  const payload = (r: unknown) => JSON.parse((r as Result).content[0]!.text) as Record<string, unknown>;

  /** Settles-flag of a promise, to prove a call is still waiting. */
  const track = <T,>(p: Promise<T>) => {
    const state = { settled: false };
    p.then(
      () => (state.settled = true),
      () => (state.settled = true),
    );
    return state;
  };

  it('[ac:ac-wywolanie-narzedzia-na-polaczeniu-kto] [section:reys7qo4] [section:m12edge0] a tools/call during the rebuild after an invalidation waits for the successor and answers from it, on the same connection', async () => {
    const projUrl = `${base}/api/projects/app-spec/mcp`;
    const { client, transport } = await connect(projUrl);
    const first = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(text(first)).toContain('generation-1');
    const sessionId = transport.sessionId;
    expect(sessionId).toBeTruthy();

    // The invalidation queues the rebuild at once — it does not wait for the
    // connection — and the predecessor (no turn in flight) is released.
    holdBuilds();
    cache.invalidate('app-spec');
    expect(ofProject('app-spec')[0]!.disposed).toBe(true);

    const getSpy = vi.spyOn(cache, 'get');
    const pending = client.callTool({ name: 'list_projects', arguments: {} });
    const state = track(pending);
    // The call reached the cache and waits there for the successor.
    await vi.waitFor(() => expect(getSpy).toHaveBeenCalled());
    await new Promise((resolve) => setImmediate(resolve));
    expect(state.settled).toBe(false);

    releaseBuilds();
    const result = await pending;
    expect(result.isError).toBeFalsy();
    // The operation's result comes from the successor context…
    expect(text(result)).toContain('generation-2');
    expect(text(result)).not.toContain('generation-1');
    // …on the same session — no reconnect, no new handshake.
    expect(transport.sessionId).toBe(sessionId);
    const again = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(text(again)).toContain('generation-2');
  });

  it('[ac:ac-wywolanie-narzedzia-na-polaczeniu-kto] on the workspace mount a call naming the invalidated project waits for its successor and answers the operation', async () => {
    const { client, transport } = await connect(`${base}/api/workspace/mcp`);
    const first = await client.callTool({ name: 'overview', arguments: { project: 'app-spec' } });
    expect(first.isError).toBeFalsy();
    const sessionId = transport.sessionId;

    holdBuilds();
    cache.invalidate('app-spec');
    const getSpy = vi.spyOn(cache, 'get');
    const pending = client.callTool({ name: 'overview', arguments: { project: 'app-spec' } });
    const state = track(pending);
    // The call's per-call resolution reached the cache and waits for `app-spec`.
    await vi.waitFor(() => expect(getSpy.mock.calls.some(([p]) => p.id === 'app-spec')).toBe(true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(state.settled).toBe(false);

    releaseBuilds();
    const result = await pending;
    expect(result.isError).toBeFalsy();
    // Answered by a successor build of `app-spec`, the predecessor released.
    expect(ofProject('app-spec').map((g) => g.disposed)).toEqual([true, false]);
    expect(transport.sessionId).toBe(sessionId);
  });

  it('[ac:ac-otwarte-polaczenie-mcp-nie-utrzymuje] [section:reys7qo4] [section:m12krit0] tools/list_changed is sent on a real plugin pool change, not on a rebuild of the same pool', async () => {
    let notified = 0;
    const { client } = await connect(`${base}/api/projects/app-spec/mcp`, () => notified++);
    const before = (await client.listTools()).tools.map((t) => t.name);
    // The probe is provably absent before the change, whatever base plugins are installed.
    expect(before).not.toContain(PROBE_TOOL);
    // Counted server-side, from here on: the handshake's own registration is not a change.
    const sent = vi.spyOn(McpServer.prototype, 'sendToolListChanged');

    // A rebuild after an invalidation that leaves the pool as it was: a NEW
    // context and a recomposed surface, the same tool list — no notification.
    cache.invalidate('app-spec');
    const same = await client.callTool({ name: 'overview', arguments: {} });
    expect(same.isError).toBeFalsy();
    expect(ofProject('app-spec')).toHaveLength(2);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(before);
    expect(sent).not.toHaveBeenCalled();
    expect(notified).toBe(0);

    // A plugin joins the pool (install / activation — axis B): the list really
    // changes, and the connection is told.
    poolChanged = true;
    cache.invalidate('app-spec');
    const changed = await client.callTool({ name: 'overview', arguments: {} });
    expect(changed.isError).toBeFalsy();
    expect(ofProject('app-spec')).toHaveLength(3);
    expect(sent).toHaveBeenCalled();
    await vi.waitFor(() => expect(notified).toBeGreaterThan(0));
    // The real change, as a diff of tool names: exactly the probe joined, nothing left.
    const after = (await client.listTools()).tools.map((t) => t.name);
    expect(after.filter((n) => !before.includes(n))).toEqual([PROBE_TOOL]);
    expect(before.filter((n) => !after.includes(n))).toEqual([]);
  });

  it('[ac:ac-otwarte-polaczenie-mcp-nie-chroni-pro] [section:xocjjal4] [section:kl277elf] detaching a project with open MCP connections releases its context, and the next call is refused as a project outside the workspace', async () => {
    const projUrl = `${base}/api/projects/app-spec/mcp`;
    const proj = await connect(projUrl);
    const ws = await connect(`${base}/api/workspace/mcp`);
    expect((await proj.client.callTool({ name: 'overview', arguments: {} })).isError).toBeFalsy();
    expect((await ws.client.callTool({ name: 'overview', arguments: { project: 'app-spec' } })).isError).toBeFalsy();

    // Two open sessions on the project — neither is a turn.
    const [ctx] = ofProject('app-spec');
    expect(ctx!.activeAdapters.size).toBe(0);
    expect(ctx!.disposed).toBe(false);

    detach('app-spec');
    // Released at the detach, the open connections notwithstanding.
    expect(ctx!.disposed).toBe(true);

    // Project-bound: the next call is refused before any handler.
    const viaProject = await toolsCall(projUrl, proj.transport.sessionId!, 'overview');
    expect(viaProject.status).toBe(404);
    expect(((await viaProject.json()) as { error: { code: string } }).error.code).toBe('PROJECT_NOT_IN_WORKSPACE');

    // Workspace-bound: the session survives; the call is refused tool-level.
    const viaWorkspace = await ws.client.callTool({ name: 'overview', arguments: { project: 'app-spec' } });
    expect(viaWorkspace.isError).toBe(true);
    expect(payload(viaWorkspace).code).toBe('PROJECT_NOT_IN_WORKSPACE');
    // No call rebuilt the detached project.
    expect(ofProject('app-spec')).toHaveLength(1);
  });

  it('[ac:ac-otwarte-polaczenie-mcp-nie-chroni-pro] [section:xocjjal4] a call waiting for a rebuild when its project is detached is refused as outside the workspace, and the dropped build is released', async () => {
    const projUrl = `${base}/api/projects/app-spec/mcp`;
    const proj = await connect(projUrl);
    const ws = await connect(`${base}/api/workspace/mcp`);
    expect((await proj.client.callTool({ name: 'overview', arguments: {} })).isError).toBeFalsy();
    expect((await ws.client.callTool({ name: 'overview', arguments: { project: 'app-spec' } })).isError).toBeFalsy();

    holdBuilds();
    cache.invalidate('app-spec');
    const getSpy = vi.spyOn(cache, 'get');
    const viaProject = toolsCall(projUrl, proj.transport.sessionId!, 'overview');
    const viaWorkspace = ws.client.callTool({ name: 'overview', arguments: { project: 'app-spec' } });
    // Both calls wait in the cache for the successor of `app-spec`.
    await vi.waitFor(() =>
      expect(getSpy.mock.calls.filter(([p]) => p.id === 'app-spec').length).toBeGreaterThanOrEqual(2),
    );

    detach('app-spec');

    const res = await viaProject;
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PROJECT_NOT_IN_WORKSPACE');
    const wsResult = await viaWorkspace;
    expect(wsResult.isError).toBe(true);
    expect(payload(wsResult).code).toBe('PROJECT_NOT_IN_WORKSPACE');

    // The build that was running for the detached project ends and its result
    // is released — never served.
    releaseBuilds();
    await vi.waitFor(() => expect(ofProject('app-spec')).toHaveLength(2));
    await vi.waitFor(() => expect(ofProject('app-spec')[1]!.disposed).toBe(true));
  });
  it('[carried:U6-rev-0001] an idle open MCP session does not keep the released context reachable: after the rebuild its plugin host is collected, and the session answers from the successor', async () => {
    // `--expose-gc` for this worker only: the observable is reachability itself.
    v8.setFlagsFromString('--expose_gc');
    const gc = runInNewContext('gc') as () => void;
    const collect = async () => {
      // A WeakRef target stays alive until the end of the job that read it — let
      // the job end before collecting, and again before reading.
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setImmediate(resolve));
        gc();
      }
      await new Promise((resolve) => setImmediate(resolve));
    };

    let notified = 0;
    const { client, transport } = await connect(`${base}/api/projects/app-spec/mcp`, () => notified++);
    const before = (await client.listTools()).tools.map((t) => t.name);
    // The session has synced to generation 1: its surface's handlers close over generation 1's host.
    expect(text(await client.callTool({ name: 'list_projects', arguments: {} }))).toContain('generation-1');

    // The rebuild, with the connection left IDLE — no request on it from here on.
    cache.invalidate('app-spec');
    await cache.get(workspace.projects.find((p) => p.id === 'app-spec')!);
    const [first, second] = ofProject('app-spec');
    expect(first!.disposed).toBe(true);
    expect(second!.disposed).toBe(false);

    await collect();
    // The released generation is gone although the session is still open…
    expect(first!.host.deref()).toBeUndefined();
    // …while the live one is held by its context, as it should be.
    expect(second!.host.deref()).toBeDefined();

    // The idle session still works: the next call re-syncs and answers from the
    // successor, on the same session, with no tools/list_changed for an unchanged pool.
    const sessionId = transport.sessionId;
    const after = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(after.isError).toBeFalsy();
    expect(text(after)).toContain('generation-2');
    expect(transport.sessionId).toBe(sessionId);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(before);
    expect(notified).toBe(0);
  });

  it('[carried:U6-rev-0001] a deferred dispose of the predecessor leaves a session already re-synced to the successor intact: a call past its re-sync answers from the successor', async () => {
    const { client } = await connect(`${base}/api/projects/app-spec/mcp`);
    expect(text(await client.callTool({ name: 'list_projects', arguments: {} }))).toContain('generation-1');

    // A turn in flight on generation 1: the invalidation retires it, but its
    // dispose waits for the turn's end (`reapIdle` from the turn's finally).
    const [first] = ofProject('app-spec');
    first!.activeAdapters.set('turn-1', {});
    cache.invalidate('app-spec');
    await cache.get(workspace.projects.find((p) => p.id === 'app-spec')!);
    const [, second] = ofProject('app-spec');
    expect(first!.disposed).toBe(false);
    expect(second!.disposed).toBe(false);

    // The session re-syncs to the successor on its next request.
    expect(text(await client.callTool({ name: 'list_projects', arguments: {} }))).toContain('generation-2');

    // The next tools/call is held between its re-sync and its handler lookup —
    // exactly there the predecessor's turn ends and the deferred dispose runs.
    const original = StreamableHTTPServerTransport.prototype.handleRequest;
    let disposedMidCall = false;
    vi.spyOn(StreamableHTTPServerTransport.prototype, 'handleRequest').mockImplementation(async function (
      this: StreamableHTTPServerTransport,
      ...args: Parameters<StreamableHTTPServerTransport['handleRequest']>
    ) {
      const body = args[2] as { method?: string } | undefined;
      if (!disposedMidCall && body?.method === 'tools/call') {
        disposedMidCall = true;
        first!.activeAdapters.clear();
        cache.reapIdle();
        expect(first!.disposed).toBe(true);
      }
      return original.apply(this, args);
    });

    const during = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(disposedMidCall).toBe(true);
    // The predecessor's release did not empty the successor's handlers.
    expect(during.isError).toBeFalsy();
    expect(text(during)).toContain('generation-2');
    expect(second!.disposed).toBe(false);
  });
});

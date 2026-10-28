import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
  }
  let generations: Generation[] = [];
  let counter = 0;
  /** While set, every build waits for it — a rebuild "in progress". */
  let gate: Promise<void> | null = null;
  let releaseGate: (() => void) | null = null;
  /** When true, the next builds carry one more plugin (a real pool change). */
  let poolChanged = false;

  const ofProject = (id: string) => generations.filter((g) => g.projectId === id);

  /** A plugin of the changed pool: its own server with one tool. */
  const spreadsheetServer = () => ({
    name: 'spreadsheet-tools',
    server: createMcpServer({
      name: 'spreadsheet-tools',
      tools: [mcpTool('set_cell', 'set_cell description', { x: z.string().optional() }, async () => ({ content: [] }))],
    }) as unknown as McpServerFactory,
  });

  /** A per-generation host: same plugins as the harness, plus the changed pool when asked. */
  const hostFor = (withPlugin: boolean): ExternalSurfaceDeps['pluginHost'] =>
    ({
      buildMcpServers: (o?: { include?: (name: string) => boolean }) => [
        ...app.host.buildMcpServers(o),
        ...(withPlugin ? [spreadsheetServer()].filter((s) => !o?.include || o.include(s.name)) : []),
      ],
      listEntities: () => [...app.host.listEntities(), ...(withPlugin ? [{ type: 'spreadsheet' }] : [])],
    }) as unknown as ExternalSurfaceDeps['pluginHost'];

  const build = async (project: ProjectRecord): Promise<ProjectContext> => {
    if (gate) await gate;
    const record: Generation = { projectId: project.id, gen: ++counter, disposed: false, activeAdapters: new Map() };
    generations.push(record);
    const host = hostFor(poolChanged);
    const surfaceDeps = (profile: ChatContextType): ExternalSurfaceDeps => ({
      ...app.mcpSurfaceDeps(profile),
      pluginHost: host,
      listProjects: () => ({ workspace: 'default', projects: [{ id: project.id, name: `generation-${record.gen}` }] }),
    });
    const router = express.Router();
    router.use('/mcp', projectMcpRouter('0.0.0-test', project.id, surfaceDeps));
    return {
      projectId: project.id,
      cwd: app.cwd,
      mcpSurfaceDeps: surfaceDeps,
      router,
      hasInFlightTurn: () => record.activeAdapters.size > 0,
      dispose: async () => {
        record.disposed = true;
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
    expect(before).not.toContain('set_cell');
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
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('set_cell');
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
});

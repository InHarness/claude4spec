import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { workspaceMcpRouter } from '../../../src/server/routes/mcp.js';
import { __resetMcpSessions } from '../../../src/server/mcp/http-mount.js';
import type { ProjectContext } from '../../../src/server/workspace/project-context.js';
import type { ProjectContextCache } from '../../../src/server/workspace/context-cache.js';
import type { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import type { WorkspaceRecord } from '../../../src/server/workspace/types.js';

/**
 * 0.2.13 §3 — the `workspace-bound` mount; 2.1.28 — `project` per call.
 *
 * Both mounts carry the same protocol and the same catalog; the ONLY difference
 * is that the project parameter has no default here (M12 `np1dkobs`). So the
 * connection carries no project: every project-scoped call names one in its
 * `project` argument, and workspace-scoped ones (`list_projects`) need none.
 * The tests are about where the project comes from and what happens when it is
 * absent, wrong, or evicted mid-connection — not about the surface, which
 * `mcp-over-http.test.ts` already covers.
 */
describe('workspace-bound MCP mount', () => {
  let appA: TestApp;
  let appB: TestApp;
  let server: http.Server;
  let baseUrl: string;
  const open: Client[] = [];

  /** How many times the cache was asked to BUILD a context, not merely fetch one. */
  let builds = 0;
  /** Which project ids the cache was asked for, in order. */
  const asked: string[] = [];
  const live = new Map<string, ProjectContext>();
  /** Set true by the fake context, so a test can prove the mount never sets it. */
  let inFlight = false;

  type Result = { isError?: boolean; content: Array<{ type: string; text: string }> };
  const payload = (r: unknown) => JSON.parse((r as Result).content[0]!.text) as Record<string, unknown>;

  beforeAll(async () => {
    appA = await createTestApp();
    appB = await createTestApp();

    const fakeCtx = (app: TestApp): ProjectContext => {
      builds++;
      return {
        mcpSurfaceDeps: app.mcpSurfaceDeps,
        hasInFlightTurn: () => inFlight,
        dispose: async () => {},
      } as unknown as ProjectContext;
    };

    const registry = {
      getWorkspace: () => workspace,
    } as unknown as WorkspaceRegistry;
    const workspace = {
      name: 'default',
      projects: [
        { id: 'proj-a', cwd: appA.cwd },
        // Two projects of ONE workspace whose names would have collided; since
        // 2.1.0 each has its own id and a shared prefix addresses neither.
        { id: 'twin-1', cwd: appA.cwd },
        { id: 'twin-2', cwd: appB.cwd },
      ],
    } as unknown as WorkspaceRecord;
    const cache = {
      get: async (p: { id: string }) => {
        asked.push(p.id);
        let ctx = live.get(p.id);
        if (!ctx) {
          ctx = fakeCtx(p.id === 'twin-2' ? appB : appA);
          live.set(p.id, ctx);
        }
        return ctx;
      },
    } as unknown as ProjectContextCache;

    const expressApp = express();
    expressApp.use(express.json({ limit: '2mb' }));
    // Same prefix `workspaceRouter` gives it in production — the sub-router
    // registers its verbs at `/`, so the mount path is where the URL comes from.
    expressApp.use(
      '/api/workspace/mcp',
      workspaceMcpRouter({ registry, workspace, cache, packageVersion: '0.0.0-test' }) as express.Router,
    );
    server = http.createServer(expressApp);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/workspace/mcp`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    appA.cleanup();
    appB.cleanup();
  });

  afterEach(async () => {
    for (const c of open.splice(0)) await c.close().catch(() => {});
    __resetMcpSessions();
  });

  async function connect(query = ''): Promise<Client> {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl + query)));
    open.push(client);
    return client;
  }

  const initialize = (query: string) =>
    fetch(baseUrl + query, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    });

  it('accepts a handshake that names no project — the connection carries none', async () => {
    const res = await initialize('');
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });

  it('[ac:ac-polaczenie-przypiete-do-jednego-proje] list_projects needs no project and returns the workspace ids', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(result.isError).toBeFalsy();
    const ids = (payload(result).projects as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toEqual(['proj-a', 'twin-1', 'twin-2']);
  });

  it('advertises `project` on project-scoped tools and not on workspace-scoped ones', async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools;
    const props = (name: string) =>
      Object.keys((tools.find((t) => t.name === name)?.inputSchema as { properties?: object }).properties ?? {});
    expect(props('overview')).toContain('project');
    expect(props('get_entities')).toContain('project');
    expect(props('create_entities')).toContain('project');
    expect(props('list_projects')).not.toContain('project');
  });

  it('resolves `project` per call — one session addresses two projects', async () => {
    const client = await connect();
    const first = await client.callTool({ name: 'overview', arguments: { project: 'proj-a' } });
    expect(first.isError).toBeFalsy();
    asked.length = 0;
    // Same session, a different project: no `400 bound to`.
    const second = await client.callTool({ name: 'overview', arguments: { project: 'twin-2' } });
    expect(second.isError).toBeFalsy();
    expect(asked).toContain('twin-2');
  });

  it('a mutating project-scoped call with `project` lands in THAT project (no read/write split)', async () => {
    const client = await connect();
    const created = await client.callTool({ name: 'create_tag', arguments: { project: 'twin-2', name: 'Only In B' } });
    expect(created.isError).toBeFalsy();
    const slug = String(payload(created).slug);

    const inB = JSON.stringify(await client.callTool({ name: 'list_tags', arguments: { project: 'twin-2' } }));
    const inA = JSON.stringify(await client.callTool({ name: 'list_tags', arguments: { project: 'proj-a' } }));
    expect(inB).toContain(slug);
    expect(inA).not.toContain(slug);
  });

  /**
   * 2.1.0 — a project is addressed ONLY by `id`. A display name is refused with
   * PROJECT_NOT_IN_WORKSPACE at the TOOL level, listing the available ids —
   * never a directory — and the session survives for the next call.
   */
  it('[ac:ac-wywolanie-narzedzia-na-punkcie-worksp] a project NAME in `project` returns tool-level PROJECT_NOT_IN_WORKSPACE listing ids', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'overview', arguments: { project: 'Project A' } });
    expect(result.isError).toBe(true);
    const body = payload(result);
    expect(body.code).toBe('PROJECT_NOT_IN_WORKSPACE');
    expect(String(body.error)).toContain('proj-a');
    expect(String(body.error)).not.toContain(appA.cwd);
    // Still usable.
    expect((await client.callTool({ name: 'overview', arguments: { project: 'proj-a' } })).isError).toBeFalsy();
  });

  it('a shared name prefix addresses neither twin; each resolves by id', async () => {
    const client = await connect();
    const refused = await client.callTool({ name: 'overview', arguments: { project: 'twin' } });
    expect(payload(refused).code).toBe('PROJECT_NOT_IN_WORKSPACE');
    expect((await client.callTool({ name: 'overview', arguments: { project: 'twin-2' } })).isError).toBeFalsy();
  });

  it('a project-scoped call with no `project` returns tool-level PROJECT_NOT_IN_WORKSPACE', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'overview', arguments: {} });
    expect(result.isError).toBe(true);
    const body = payload(result);
    expect(body.code).toBe('PROJECT_NOT_IN_WORKSPACE');
    expect(String(body.error)).toContain('twin-2');
  });

  describe('`?project=` — compatibility default for configs generated before 2.1.28', () => {
    it('fills `project` when a call omits it, and a call may still name another', async () => {
      const client = await connect('?project=twin-2');
      expect((await client.callTool({ name: 'overview', arguments: {} })).isError).toBeFalsy();
      asked.length = 0;
      expect((await client.callTool({ name: 'overview', arguments: { project: 'proj-a' } })).isError).toBeFalsy();
      expect(asked).toContain('proj-a');
    });

    it('a default that is not a project of this workspace still refuses the handshake', async () => {
      const res = await initialize('?project=' + encodeURIComponent('Project A'));
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { message: string; data: { code: string } } };
      expect(body.error.data.code).toBe('PROJECT_NOT_IN_WORKSPACE');
      expect(body.error.message).toContain('proj-a');
      expect(body.error.message).not.toContain(appA.cwd);
    });
  });

  it('carries the same catalog as the project-bound mount', async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('overview');
    expect(names).toContain('create_entities');
    expect(names).toContain('list_projects');
  });

  it('gates by profile here too', async () => {
    const client = await connect('?profile=ask');
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('get_entities');
    expect(names).not.toContain('create_entities');
  });

  describe('a connection is not a turn', () => {
    it('never raises hasInFlightTurn, however many calls it makes', async () => {
      const client = await connect();
      await client.callTool({ name: 'overview', arguments: { project: 'proj-a' } });
      await client.callTool({ name: 'overview', arguments: { project: 'twin-2' } });
      // An MCP connection that counted as a turn would block a purge and pin the
      // context against LRU eviction for as long as an editor stayed open.
      expect(inFlight).toBe(false);
    });

    it('re-resolves the context per call rather than closing over one', async () => {
      const client = await connect();
      await client.callTool({ name: 'overview', arguments: { project: 'twin-2' } });
      const buildsBefore = builds;

      // What eviction looks like from the mount's side: the cache hands back a
      // NEW context on the next request. The call must answer the operation, not
      // fail the connection — a resume-SSE client holds nothing but this session.
      live.clear();
      const result = await client.callTool({ name: 'overview', arguments: { project: 'twin-2' } });
      expect(result.isError).toBeFalsy();
      expect(builds).toBeGreaterThan(buildsBefore);
    });
  });
});

/**
 * The binding is pinned to the session, like the profile.
 *
 * A client holding a session id controls the query string of every later
 * request. Without the pin, one could carry an established session's header with
 * a different `?project=` and have the tool set swapped underneath it — the
 * connection would be reading one specification while its handshake said
 * another.
 */
describe('a session cannot be re-pointed at another project', () => {
  it('rejects a request whose ?project= differs from the session it claims', async () => {
    const app = await createTestApp();
    const registry = { getWorkspace: () => workspace } as unknown as WorkspaceRegistry;
    const workspace = {
      name: 'default',
      projects: [
        { id: 'proj-a', cwd: app.cwd, name: 'A' },
        { id: 'proj-b', cwd: app.cwd, name: 'B' },
      ],
    } as unknown as WorkspaceRecord;
    const cache = {
      get: async () =>
        ({ mcpSurfaceDeps: app.mcpSurfaceDeps, hasInFlightTurn: () => false, dispose: async () => {} }) as unknown as ProjectContext,
    } as unknown as ProjectContextCache;

    const expressApp = express();
    expressApp.use(express.json());
    expressApp.use('/api/workspace/mcp', workspaceMcpRouter({ registry, workspace, cache, packageVersion: '0.0.0-test' }));
    const srv = http.createServer(expressApp);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/workspace/mcp`;

    try {
      const init = await fetch(`${url}?project=proj-a`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
        }),
      });
      const sid = init.headers.get('mcp-session-id');
      expect(sid).toBeTruthy();

      // `proj-b` EXISTS here; the companion case below uses a project that does
      // not, and both must be refused identically — otherwise the status code
      // tells a caller bound elsewhere whether a name is in the workspace.
      const hijack = await fetch(`${url}?project=proj-b`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-session-id': sid!,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      });
      expect(hijack.status).toBe(400);
      const body = (await hijack.json()) as { error: { data: { code: string }; message: string } };
      expect(body.error.data.code).toBe('VALIDATION');
      expect(body.error.message).toContain('proj-a');

      // A project that is NOT in the workspace must give the SAME answer. If the
      // binding were checked after resolution, this would be 404 and the pair
      // would leak workspace membership one guess at a time.
      const probe = await fetch(`${url}?project=does-not-exist`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-session-id': sid!,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
      });
      expect(probe.status).toBe(400);
      expect(((await probe.json()) as { error: { data: { code: string } } }).error.data.code).toBe('VALIDATION');
    } finally {
      __resetMcpSessions();
      await new Promise<void>((r) => srv.close(() => r()));
      app.cleanup();
    }
  });
});

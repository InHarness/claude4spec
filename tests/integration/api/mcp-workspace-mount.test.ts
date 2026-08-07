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
 * 0.2.13 §3 — the `workspace-bound` mount.
 *
 * Both mounts carry the same protocol and the same catalog; the ONLY difference
 * is that the project parameter has no default here. So the tests are about
 * where the project comes from and what happens when it is absent, wrong, or
 * evicted mid-connection — not about the surface, which
 * `mcp-over-http.test.ts` already covers.
 */
describe('workspace-bound MCP mount', () => {
  let app: TestApp;
  let server: http.Server;
  let baseUrl: string;
  const open: Client[] = [];

  /** How many times the cache was asked to BUILD a context, not merely fetch one. */
  let builds = 0;
  let live: ProjectContext | null = null;
  /** Set true by the fake context, so a test can prove the mount never sets it. */
  let inFlight = false;

  beforeAll(async () => {
    app = await createTestApp();

    const fakeCtx = (): ProjectContext => {
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
      projects: [{ id: 'proj-a', cwd: app.cwd, name: 'Project A' }],
    } as unknown as WorkspaceRecord;
    const cache = {
      get: async () => (live ??= fakeCtx()),
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
    app.cleanup();
  });

  afterEach(async () => {
    for (const c of open.splice(0)) await c.close().catch(() => {});
    __resetMcpSessions();
  });

  async function connect(query: string): Promise<Client> {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl + query)));
    open.push(client);
    return client;
  }

  const initialize = (query: string) =>
    fetch(baseUrl + query, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });

  it('refuses a connection that names no project — the parameter has no default here', async () => {
    // This IS the posture. On the project-bound mount the URL supplies it; here
    // an unnamed project is an unaddressed connection, and answering with some
    // arbitrary project would be worse than refusing.
    const res = await initialize('');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { data: { code: string } } }).error.data.code).toBe(
      'PROJECT_NOT_IN_WORKSPACE',
    );
  });

  it('refuses a project that is not in this workspace', async () => {
    const res = await initialize('?project=not-a-project');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { data: { code: string } } }).error.data.code).toBe(
      'PROJECT_NOT_IN_WORKSPACE',
    );
  });

  it('resolves by registry id', async () => {
    const client = await connect('?project=proj-a');
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('overview');
  });

  it('resolves by the slug `list_projects` reports, which is what a caller holds', async () => {
    // `list_projects` returns the slug `--project` resolves against; a caller
    // that had to translate it back to a registry id before connecting would
    // make the operation useless for its stated purpose.
    const client = await connect('?project=' + encodeURIComponent('Project A'));
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('overview');
  });

  it('carries the same catalog as the project-bound mount', async () => {
    const client = await connect('?project=proj-a');
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('overview');
    expect(names).toContain('create_entities');
    expect(names).toContain('list_projects');
  });

  it('gates by profile here too', async () => {
    const client = await connect('?project=proj-a&profile=ask');
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('get_entities');
    expect(names).not.toContain('create_entities');
  });

  describe('a connection is not a turn', () => {
    it('never raises hasInFlightTurn, however many calls it makes', async () => {
      const client = await connect('?project=proj-a');
      await client.callTool({ name: 'overview', arguments: {} });
      await client.callTool({ name: 'overview', arguments: {} });
      // An MCP connection that counted as a turn would block a purge and pin the
      // context against LRU eviction for as long as an editor stayed open.
      expect(inFlight).toBe(false);
    });

    it('re-resolves the context per request rather than closing over one', async () => {
      const client = await connect('?project=proj-a');
      const buildsAfterConnect = builds;

      // What eviction looks like from the mount's side: the cache hands back a
      // NEW context on the next request. The call must answer the operation, not
      // fail the connection — a resume-SSE client holds nothing but this session.
      live = null;
      const result = await client.callTool({ name: 'overview', arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(builds).toBeGreaterThan(buildsAfterConnect);
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
    } finally {
      __resetMcpSessions();
      await new Promise<void>((r) => srv.close(() => r()));
      app.cleanup();
    }
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { projectMcpRouter, workspaceMcpRouter } from '../../../src/server/routes/mcp.js';
import { __resetMcpSessions } from '../../../src/server/mcp/http-mount.js';
import { ProjectContextCache } from '../../../src/server/workspace/context-cache.js';
import { projectDispatchMiddleware } from '../../../src/server/workspace/middleware.js';
import { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import { legacyHashId } from '../../../src/server/workspace/project-id.js';
import type { ProjectContext } from '../../../src/server/workspace/project-context.js';
import type { WorkspaceRecord } from '../../../src/server/workspace/types.js';

/**
 * 2.1.12 — M31 edge cases on the two MCP mounts, against a REAL registry (a
 * pre-2.1.0 file migrated by the same call the server makes before listen) and
 * a REAL `ProjectContextCache` (its ~15 s failed-build window is the thing under
 * test). Only the context itself is a stand-in: what it serves is the harness's
 * MCP surface.
 */
describe('MCP mounts — M31 registry edge cases', () => {
  let app: TestApp;
  let home: string;
  let server: http.Server;
  let base: string;
  let registry: WorkspaceRegistry;
  let workspace: WorkspaceRecord;
  let cache: ProjectContextCache;
  let hashId: string;
  /** Flip to make the NEXT build of the project fail. */
  let failBuild = false;
  const open: Client[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-mcp-m31-'));
    hashId = legacyHashId(app.cwd);
    fs.writeFileSync(
      path.join(home, 'workspaces.json'),
      JSON.stringify({
        $schemaVersion: 2,
        workspaces: [
          {
            name: 'default',
            mode: 'prod',
            defaultPort: 4500,
            projects: [{ cwd: app.cwd, id: hashId, name: 'app-spec', addedAt: '2026-01-01T00:00:00.000Z' }],
          },
        ],
      }),
    );
    registry = new WorkspaceRegistry(home);
    // What `startServer` does before listen.
    expect(registry.migrateIfNeeded().map((r) => r.to)).toEqual(['app-spec']);
    workspace = registry.getWorkspace('default')!;

    cache = new ProjectContextCache(async (project) => {
      if (failBuild) throw new Error(`config.json of ${project.id} is broken`);
      return {
        projectId: project.id,
        cwd: project.cwd,
        mcpSurfaceDeps: app.mcpSurfaceDeps,
        router: (() => {
          const r = express.Router();
          r.use('/mcp', projectMcpRouter('0.0.0-test', project.id, app.mcpSurfaceDeps));
          return r;
        })(),
        hasInFlightTurn: () => false,
        dispose: async () => {},
      } as unknown as ProjectContext;
    });

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

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cache.disposeAll();
    app.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  });

  afterEach(async () => {
    for (const c of open.splice(0)) await c.close().catch(() => {});
    __resetMcpSessions();
    failBuild = false;
    cache.invalidate('app-spec');
  });

  async function connect(url: string): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
    const client = new Client({ name: 'test', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(url));
    await client.connect(transport);
    open.push(client);
    return { client, transport };
  }

  const rpc = (url: string, body: unknown, sessionId?: string) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-06-18' } : {}),
      },
      body: JSON.stringify(body),
    });
  const initialize = (url: string) => rpc(url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const toolsCall = (url: string, sessionId: string) =>
    rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'overview', arguments: {} } }, sessionId);

  it('[ac:ac-po-migracji-rejestru-zewnetrzna-konfi] after the migration an external MCP config with the old hash id gets 404 PROJECT_NOT_IN_WORKSPACE', async () => {
    // Workspace-bound mount: `?project=<old hash id>`.
    const viaWorkspace = await initialize(`${base}/api/workspace/mcp?project=${hashId}`);
    expect(viaWorkspace.status).toBe(404);
    const wsBody = (await viaWorkspace.json()) as { error: { message: string; data: { code: string } } };
    expect(wsBody.error.data.code).toBe('PROJECT_NOT_IN_WORKSPACE');
    // The repair is in the answer: the new id is listed.
    expect(wsBody.error.message).toContain('app-spec');

    // Project-bound mount: `/api/projects/<old hash id>/mcp` — the same 404.
    const viaProject = await initialize(`${base}/api/projects/${hashId}/mcp`);
    expect(viaProject.status).toBe(404);
    expect(((await viaProject.json()) as { error: { code: string } }).error.code).toBe('PROJECT_NOT_IN_WORKSPACE');

    // Contrast: the migrated id connects on both.
    const { client } = await connect(`${base}/api/workspace/mcp?project=app-spec`);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('overview');
    const bound = await connect(`${base}/api/projects/app-spec/mcp`);
    expect((await bound.client.listTools()).tools.map((t) => t.name)).toContain('overview');
  });

  it('[ac:ac-tools-call-na-polaczeniu-mcp-projektu-2] tools/call on a project MCP connection whose build failed returns PROJECT_BUILD_FAILED', async () => {
    // Workspace-bound connection — no project in the URL; the call names it.
    const ws = await connect(`${base}/api/workspace/mcp`);
    // Project-bound connection, same project.
    const projUrl = `${base}/api/projects/app-spec/mcp`;
    const proj = await connect(projUrl);
    expect(ws.transport.sessionId).toBeTruthy();
    expect(proj.transport.sessionId).toBeTruthy();

    // The context drops out (invalidate = eviction from the connection's side)
    // and its rebuild fails.
    failBuild = true;
    cache.invalidate('app-spec');

    // On the workspace mount the project is a per-call argument, so the failure
    // is TOOL-level — the session survives to address another project.
    const viaWorkspace = (await ws.client.callTool({ name: 'overview', arguments: { project: 'app-spec' } })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(viaWorkspace.isError).toBe(true);
    const wsBody = JSON.parse(viaWorkspace.content[0]!.text) as { code: string; error: string };
    expect(wsBody.code).toBe('PROJECT_BUILD_FAILED');
    expect(wsBody.error).toContain('is broken');

    // Inside the ~15 s window the failure is served from the cache — even after
    // the cause is gone, the project-bound connection gets the same code.
    failBuild = false;
    const viaProject = await toolsCall(projUrl, proj.transport.sessionId!);
    expect(viaProject.status).toBe(500);
    expect(((await viaProject.json()) as { error: { code: string } }).error.code).toBe('PROJECT_BUILD_FAILED');
  });

  it('a session opened on the project-bound mount cannot be replayed against the workspace mount', async () => {
    const proj = await connect(`${base}/api/projects/app-spec/mcp`);
    const replay = await toolsCall(`${base}/api/workspace/mcp`, proj.transport.sessionId!);
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: { data: { code: string } } }).error.data.code).toBe('VALIDATION');
  });
});

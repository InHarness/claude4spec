import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { workspaceMcpRouter } from '../../../src/server/routes/mcp.js';
import { __resetMcpSessions } from '../../../src/server/mcp/http-mount.js';
import type { ChatContextType } from '../../../src/shared/entities.js';
import type { ProjectContext } from '../../../src/server/workspace/project-context.js';
import type { ProjectContextCache } from '../../../src/server/workspace/context-cache.js';
import type { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import type { WorkspaceRecord } from '../../../src/server/workspace/types.js';

/**
 * 2.1.77 (M12 `ikg2bklu`) on the WORKSPACE-bound mount — ASSUMPTION:dev-0805.
 *
 * The `brief`/`patch` refusal at set-up does not depend on which project is the
 * template: it is refused only when no project of the workspace has `briefs`,
 * and otherwise accepted with the catalog of a project that holds the profile.
 * A call targeting a project without `briefs` answers NOT_FOUND, like any tool
 * that project's catalog lacks.
 */
describe('workspace-bound MCP mount: profile gate across project types (dev-0805)', () => {
  let skillA: TestApp;
  let skillB: TestApp;
  let spec: TestApp;
  let server: http.Server;
  let origin: string;
  const open: Client[] = [];

  type Result = { isError?: boolean; content: Array<{ type: string; text: string }> };
  const payload = (r: unknown) => JSON.parse((r as Result).content[0]!.text) as Record<string, unknown>;

  beforeAll(async () => {
    // Separate apps, so the surface memo (keyed on plugin host) never mixes types.
    skillA = await createTestApp();
    skillB = await createTestApp();
    spec = await createTestApp();

    const ctxOf = (app: TestApp, capabilities: Set<string>): ProjectContext =>
      ({
        mcpSurfaceDeps: (profile: ChatContextType) => ({ ...app.mcpSurfaceDeps(profile), capabilities }),
        hasInFlightTurn: () => false,
        dispose: async () => {},
      }) as unknown as ProjectContext;
    const contexts = new Map<string, ProjectContext>([
      ['skill-a', ctxOf(skillA, new Set())],
      ['skill-b', ctxOf(skillB, new Set())],
      ['spec-1', ctxOf(spec, new Set(['briefs', 'entities']))],
    ]);
    const cache = { get: async (p: { id: string }) => contexts.get(p.id)! } as unknown as ProjectContextCache;

    const mount = (name: string, ids: string[]) => {
      const workspace = {
        name,
        projects: ids.map((id) => ({ id, cwd: `/tmp/${id}` })),
      } as unknown as WorkspaceRecord;
      const registry = { getWorkspace: () => workspace } as unknown as WorkspaceRegistry;
      return workspaceMcpRouter({ registry, workspace, cache, packageVersion: '0.0.0-test' }) as express.Router;
    };

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    // The `skill` project is FIRST, so it would be the template without the gate.
    app.use('/mixed/mcp', mount('mixed', ['skill-a', 'spec-1']));
    app.use('/skills/mcp', mount('skills', ['skill-a', 'skill-b']));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    skillA?.cleanup();
    skillB?.cleanup();
    spec?.cleanup();
  });

  afterEach(async () => {
    for (const c of open.splice(0)) await c.close().catch(() => {});
    __resetMcpSessions();
  });

  async function connect(path: string): Promise<Client> {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(origin + path)));
    open.push(client);
    return client;
  }

  const initialize = (path: string) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    });

  it('refuses `brief` and `patch` at set-up when no project of the workspace has `briefs`', async () => {
    for (const profile of ['brief', 'patch']) {
      const res = await initialize(`/skills/mcp?profile=${profile}`);
      expect(res.status, profile).toBe(400);
      const body = (await res.json()) as { error: { data: { code: string }; message: string } };
      expect(body.error.data.code).toBe('VALIDATION');
      expect(body.error.message).toContain(profile);
      expect(res.headers.get('mcp-session-id')).toBeNull();
    }
    // `chat` still sets up.
    const chat = await connect('/skills/mcp?profile=chat');
    expect((await chat.listTools()).tools.length).toBeGreaterThan(0);
  });

  it('accepts `brief` when one project has `briefs`, whichever project is the template', async () => {
    // No default: the first project is a `skill` one.
    const noDefault = await connect('/mixed/mcp?profile=brief');
    expect((await noDefault.listTools()).tools.map((t) => t.name)).toContain('get_brief');
    // The compat default names the `skill` project: same answer.
    const skillDefault = await connect('/mixed/mcp?profile=brief&project=skill-a');
    expect((await skillDefault.listTools()).tools.map((t) => t.name)).toContain('get_brief');
  });

  it('a brief tool targeting a project without `briefs` answers NOT_FOUND, like a tool that project lacks', async () => {
    const client = await connect('/mixed/mcp?profile=brief');
    const result = await client.callTool({ name: 'get_brief', arguments: { project: 'skill-a', path: 'x.md' } });
    expect(result.isError).toBe(true);
    expect(payload(result).code).toBe('NOT_FOUND');
    // The same tool on the `spec` project reaches its own brief service.
    const onSpec = await client.callTool({ name: 'get_brief', arguments: { project: 'spec-1', path: 'x.md' } });
    expect(payload(onSpec).code).not.toBe('NOT_FOUND');
  });
});

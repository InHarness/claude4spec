import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createPluginTestApp, type PluginTestApp } from '../../../tests/helpers/plugin-test-setup.js';
import { __resetMcpSessions, activeMcpSessionCount } from './http-mount.js';
import { mcpChannelProfilesFor } from '../operations/profiles.js';

/**
 * 2.1.77 (M12 `ikg2bklu`, Odczyt możliwości) — the external MCP connection of a
 * `skill` project (no `briefs`, no `entities`), driven by a REAL MCP client over
 * a REAL HTTP listener on the project mount `/api/projects/<id>/mcp`, against a
 * `spec` control. Without `briefs` the channel table has two profiles, so a
 * handshake naming `brief` is refused at set-up; without `entities` the `chat`
 * catalog carries no entity operation.
 */
describe('external MCP of a `skill` project (2.1.77)', () => {
  let skill: PluginTestApp;
  let spec: PluginTestApp;
  let skillServer: http.Server;
  let specServer: http.Server;
  let skillUrl: string;
  let specUrl: string;
  const open: Client[] = [];

  const listen = async (t: PluginTestApp): Promise<[http.Server, string]> => {
    const server = http.createServer(t.app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return [server, `http://127.0.0.1:${(server.address() as AddressInfo).port}${t.baseUrl}/mcp`];
  };

  beforeAll(async () => {
    skill = await createPluginTestApp([], { projectType: 'skill' });
    spec = await createPluginTestApp([]);
    [skillServer, skillUrl] = await listen(skill);
    [specServer, specUrl] = await listen(spec);
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => skillServer?.close(() => resolve()));
    await new Promise<void>((resolve) => specServer?.close(() => resolve()));
    await skill?.cleanup();
    await spec?.cleanup();
  });

  afterEach(async () => {
    for (const c of open.splice(0)) await c.close().catch(() => {});
    __resetMcpSessions();
  });

  async function connect(url: string): Promise<Client> {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    open.push(client);
    return client;
  }

  const initialize = (url: string) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    });

  it('the project table: four profiles with `briefs`, two (`chat`, `ask`) without', () => {
    expect(mcpChannelProfilesFor(new Set(['briefs']))).toEqual(['chat', 'ask', 'brief', 'patch']);
    expect(mcpChannelProfilesFor(new Set())).toEqual(['chat', 'ask']);
  });

  it('[ac:m12-brief-profile-refused-without-briefs] in a `skill` project a connection of the external MCP with the profile `brief` is refused at set-up', async () => {
    const before = activeMcpSessionCount();
    const res = await initialize(`${skillUrl}?profile=brief`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { data: { code: string }; message: string } };
    expect(body.error.data.code).toBe('VALIDATION');
    expect(body.error.message).toContain('brief');
    // Refused before anything was set up: no session, no session id, no catalog.
    expect(res.headers.get('mcp-session-id')).toBeNull();
    expect(activeMcpSessionCount()).toBe(before);
    // `patch` is refused the same way; `chat` and `ask` set up.
    expect((await initialize(`${skillUrl}?profile=patch`)).status).toBe(400);
    const chat = await connect(`${skillUrl}?profile=chat`);
    expect((await chat.listTools()).tools.length).toBeGreaterThan(0);
    // Control: a `spec` project sets the `brief` profile up.
    const brief = await connect(`${specUrl}?profile=brief`);
    expect((await brief.listTools()).tools.map((t) => t.name)).toContain('get_brief');
  });

  it('[ac:m12-chat-profile-without-entity-tools] in a `skill` project `tools/list` of the external MCP connection in the profile `chat` does not contain the tool `describe_entity_type`', async () => {
    const client = await connect(`${skillUrl}?profile=chat`);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('describe_entity_type');
    // Nor any other entity operation: reads, writes, tags, DTO links.
    for (const name of [
      'describe_types',
      'get_entities',
      'list_entities',
      'search_entities',
      'create_entities',
      'list_tags',
      'create_tag',
      'tag_entity',
      'find_references',
      'link_dto',
    ]) {
      expect(names, name).not.toContain(name);
    }
    // The page reads stay.
    expect(names).toEqual(expect.arrayContaining(['overview', 'get_page', 'get_sections', 'check_consistency']));
    // Control: the `spec` project's `chat` catalog carries it.
    const control = await connect(`${specUrl}?profile=chat`);
    expect((await control.listTools()).tools.map((t) => t.name)).toContain('describe_entity_type');
  });
});

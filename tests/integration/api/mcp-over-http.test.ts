import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import express from 'express';
import { projectMcpRouter } from '../../../src/server/routes/mcp.js';
import {
  __resetMcpSessions,
  activeMcpSessionCount,
  ageAllMcpSessions,
  MCP_SESSION_IDLE_MS,
  reapIdleMcpSessions,
} from '../../../src/server/mcp/http-mount.js';

/**
 * 0.2.13 §3 — the external MCP surface moves from a standalone stdio process
 * with its own read-only SQLite handle to an in-memory composition mounted in
 * the server process.
 *
 * These tests drive a REAL MCP client over a REAL HTTP listener. A hand-rolled
 * JSON-RPC POST would have proved the route answers; it would not have proved
 * the handshake, the session header round-trip or the tool schemas are
 * well-formed enough for a client to use — which is the whole claim being made.
 */
describe('MCP over HTTP', () => {
  let app: TestApp;
  let server: http.Server;
  let baseUrl: string;
  const open: Client[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    server = http.createServer(app.app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.cleanup();
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

  it('completes a handshake and lists the composed catalog', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    // The M39 read backbone is present in full — the fourteen operations the
    // stdio server used to be the only renderer of.
    for (const name of ['overview', 'describe_types', 'get_page', 'get_sections', 'find_references']) {
      expect(names).toContain(name);
    }
    // …and so is the write side, which the old surface could not reach at all:
    // `chat` is the default profile and it admits writes.
    expect(names).toContain('create_entities');
    // M31's workspace operation, reachable from a project-BOUND connection —
    // project-bound is a parameter default, not a permission boundary.
    expect(names).toContain('list_projects');
    // One row per operation: the merge deduplicates the renderings that used to
    // sit on separate servers (`find_references` is on c4s-reader AND
    // reference-tools; `get_entities` on c4s-reader AND entity-tools).
    expect(new Set(names).size).toBe(names.length);
  });

  it('actually executes an operation, not just advertises it', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'overview', arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(result.isError).toBeFalsy();
    // The discovery core's own payload, not a transport-invented shape.
    expect(JSON.parse(text)).toHaveProperty('types');
  });

  describe('the profile is the hard gate on this channel too', () => {
    it('withholds every write from `ask`, and they are not callable by name', async () => {
      const client = await connect('?profile=ask');
      const names = (await client.listTools()).tools.map((t) => t.name);

      expect(names).toContain('get_entities');
      for (const write of ['create_entities', 'update_entities', 'delete_entities', 'create_tag']) {
        expect(names).not.toContain(write);
      }
      // Withheld means UNKNOWN, not "refused" — the point of gating the list
      // rather than the handler is that the model never learns the name.
      const refused = await client.callTool({ name: 'create_entities', arguments: {} });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused.content)).toMatch(/not found|unknown|invalid/i);
    });

    it('narrows `brief` to release-tools plus reads, per BRIEF_ALLOWED_PLUGIN_MCP', async () => {
      const client = await connect('?profile=brief');
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain('get_brief');
      expect(names).toContain('overview');
      expect(names).not.toContain('create_entities');
    });

    it('rejects an unknown profile instead of silently downgrading to chat', async () => {
      // Failing open here would hand a caller who asked to be NARROW the full
      // chat surface — the wrong direction to fail in.
      const res = await fetch(`${baseUrl}?profile=readonly`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { data: { code: string }; message: string } };
      expect(body.error.data.code).toBe('VALIDATION');
      expect(body.error.message).toContain('readonly');
    });

    it('pins the profile for the connection: a later request cannot widen it', async () => {
      const client = await connect('?profile=ask');
      // The client keeps using the session header; the mount ignores any
      // `?profile=` on subsequent requests in favour of the session's own.
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).not.toContain('create_entities');
      const again = (await client.listTools()).tools.map((t) => t.name);
      expect(again).not.toContain('create_entities');
    });
  });

  describe('the brief profile has no ambient brief', () => {
    // 0.2.40 — the field is `path`, renamed from `brief` to match the catalog
    // row and every other channel. It stays REQUIRED, which is the property
    // this test is actually about.
    it('makes `path` a required argument rather than defaulting to a brief', async () => {
      const client = await connect('?profile=brief');
      const tool = (await client.listTools()).tools.find((t) => t.name === 'update_brief')!;
      expect(tool.inputSchema.required).toContain('path');

      // The failure names the missing field. A fallback to "the" brief would
      // have written to a file the caller never named.
      const failed = await client.callTool({ name: 'update_brief', arguments: { action: 'append', content: 'x' } });
      expect(failed.isError).toBe(true);
      expect(JSON.stringify(failed.content)).toContain('path');
    });
  });

  describe('a connection is not a turn', () => {
    it('opens and calls without ever registering an in-flight turn', async () => {
      const client = await connect();
      await client.callTool({ name: 'overview', arguments: {} });
      // The harness's registry stands in for `hasInFlightTurn()`: an MCP
      // connection must never appear in it, or an editor left open overnight
      // pins the ProjectContext against eviction forever.
      expect(activeMcpSessionCount()).toBe(1);
      expect(app.broadcasts.filter((b) => JSON.stringify(b).includes('turn'))).toHaveLength(0);
    });

    it('reaps a session the client abandoned without saying goodbye', async () => {
      // `DELETE` is the protocol's way to end a session, but a quit editor, a
      // slept laptop or a crashed process never sends one — and unlike stdio
      // there is no pipe whose EOF would tell us. Without the reaper the entry
      // and its tool registry live as long as the server process.
      await connect();
      expect(activeMcpSessionCount()).toBe(1);
      expect(reapIdleMcpSessions()).toBe(0); // fresh — not idle yet
      expect(reapIdleMcpSessions(Date.now() + MCP_SESSION_IDLE_MS + 1)).toBe(1);
      expect(activeMcpSessionCount()).toBe(0);
    });
  });

  it('404s an unknown session rather than silently opening a new one', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': 'no-such-session',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { data: { code: string } } }).error.data.code).toBe('SESSION_NOT_FOUND');
  });
});

/**
 * The project mount's session binding.
 *
 * `SESSIONS` is module-global and keyed only by session id, so the binding pin
 * is the ONLY thing stopping a session id issued on one project's mount from
 * being replayed against another's. It originally returned the literal
 * `'project-bound'` — reasoning that a router instance belongs to one project,
 * which is true of the router and useless as a check, since the replay targets a
 * DIFFERENT router instance whose constant compared equal.
 */
describe('a session cannot cross between project mounts', () => {
  it('refuses a session id issued on another project', async () => {
    const a = await createTestApp();
    const b = await createTestApp();
    const app = express();
    app.use(express.json());
    app.use('/api/projects/A/mcp', projectMcpRouter('0.0.0-test', 'A', a.mcpSurfaceDeps));
    app.use('/api/projects/B/mcp', projectMcpRouter('0.0.0-test', 'B', b.mcpSurfaceDeps));
    const srv = http.createServer(app);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/projects`;

    try {
      const init = await fetch(`${base}/A/mcp`, {
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

      const crossed = await fetch(`${base}/B/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-session-id': sid!,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      });
      expect(crossed.status).toBe(400);
      const body = (await crossed.json()) as { error: { data: { code: string }; message: string } };
      expect(body.error.data.code).toBe('VALIDATION');
      expect(body.error.message).toContain('project:A');
    } finally {
      __resetMcpSessions();
      await new Promise<void>((r) => srv.close(() => r()));
      a.cleanup();
      b.cleanup();
    }
  });
});

/**
 * The reaper must not eat the session it is serving.
 *
 * It swept before the arriving request refreshed `lastSeen`, so a client whose
 * cadence is slower than the window — an editor with `c4s-spec-reader`
 * configured, exactly the case the reaper exists for — had its session deleted
 * by its own next call and answered SESSION_NOT_FOUND.
 */
describe('idle reaping vs. an arriving request', () => {
  it('keeps a session that is being used right now, however stale it looked', async () => {
    const app = await createTestApp();
    const srv = http.createServer(app.app);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/mcp`;
    const client = new Client({ name: 'idle', version: '0.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(url)));
      // Age the session past the window, exactly as wall-clock idling would.
      ageAllMcpSessions(MCP_SESSION_IDLE_MS + 1);
      // A request IS activity: the session is not idle at the moment it is used.
      const res = await client.callTool({ name: 'overview', arguments: {} });
      expect(res.isError).toBeFalsy();
      expect(activeMcpSessionCount()).toBe(1);
    } finally {
      await client.close().catch(() => {});
      __resetMcpSessions();
      await new Promise<void>((r) => srv.close(() => r()));
      app.cleanup();
    }
  });
});

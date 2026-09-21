import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { __resetMcpSessions } from '../../../src/server/mcp/http-mount.js';

/**
 * 0.2.106 (M49) — a tag assignment is a write on TWO subjects. `tag_entity` /
 * `untag_entity` announce the entity (`entity:changed`) AND every tag whose
 * membership moved (`tag:changed`), because tag views — counts, co-occurrence —
 * listen on the tag, not on the entity.
 */
describe('tag_entity / untag_entity broadcasts', () => {
  let t: TestApp;
  let server: http.Server;
  let client: Client;

  beforeAll(async () => {
    t = await createTestApp();
    // Production binds this in `buildProjectContext`; the harness does not, and
    // without it `entityExists` cannot see a schema-only type's rows.
    t.host.setRawReader(t.rawReader);
    await request(t.app)
      .post('/api/endpoints')
      .send({ slug: 'get-users', method: 'GET', path: '/users', summary: 'List users' });
    server = http.createServer(t.app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`),
      ),
    );
  });

  afterAll(async () => {
    await client.close().catch(() => {});
    __resetMcpSessions();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    t.cleanup();
  });

  const events = () =>
    t.broadcasts.filter((b) => ['entity:changed', 'tag:changed'].includes((b as { kind: string }).kind));

  it('tag_entity announces the entity and each newly assigned tag', async () => {
    t.broadcasts.length = 0;
    const res = await client.callTool({
      name: 'tag_entity',
      arguments: { type: 'endpoint', slug: 'get-users', tags: ['auth', 'public'] },
    });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    expect(events()).toEqual([
      { kind: 'entity:changed', entityType: 'endpoint', slug: 'get-users', action: 'update' },
      { kind: 'tag:changed', slug: 'auth', action: 'update' },
      { kind: 'tag:changed', slug: 'public', action: 'update' },
    ]);
  });

  it('untag_entity announces the entity and only the tags actually removed', async () => {
    t.broadcasts.length = 0;
    const res = await client.callTool({
      name: 'untag_entity',
      arguments: { type: 'endpoint', slug: 'get-users', tags: ['auth', 'never-assigned'] },
    });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    expect(events()).toEqual([
      { kind: 'entity:changed', entityType: 'endpoint', slug: 'get-users', action: 'update' },
      { kind: 'tag:changed', slug: 'auth', action: 'update' },
    ]);
  });
});

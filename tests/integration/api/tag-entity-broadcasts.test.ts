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

  /**
   * `tags[]` on this tool are NAMES; `assignTags` materializes them into slugs
   * and returns those. Announcing the input would emit a key no tag has, and
   * would re-announce on every repeat call, since the "already assigned" set it
   * is compared against holds slugs.
   */
  it('announces the tag SLUG for a name that had to be slugified, and stays quiet on a repeat', async () => {
    t.broadcasts.length = 0;
    const first = await client.callTool({
      name: 'tag_entity',
      arguments: { type: 'endpoint', slug: 'get-users', tags: ['Auth Layer'] },
    });
    expect(first.isError, JSON.stringify(first.content)).toBeFalsy();
    expect(events()).toEqual([
      { kind: 'entity:changed', entityType: 'endpoint', slug: 'get-users', action: 'update' },
      { kind: 'tag:changed', slug: 'auth-layer', action: 'update' },
    ]);

    t.broadcasts.length = 0;
    const again = await client.callTool({
      name: 'tag_entity',
      arguments: { type: 'endpoint', slug: 'get-users', tags: ['Auth Layer'] },
    });
    expect(again.isError, JSON.stringify(again.content)).toBeFalsy();
    // The entity is still re-announced (the write ran); the tag is not, because
    // its membership did not move.
    expect(events()).toEqual([
      { kind: 'entity:changed', entityType: 'endpoint', slug: 'get-users', action: 'update' },
    ]);

    await client.callTool({
      name: 'untag_entity',
      arguments: { type: 'endpoint', slug: 'get-users', tags: ['auth-layer'] },
    });
  });

  /**
   * The same operation reached from the UI. Until M49 these routes announced
   * nothing, so a second tab saw an agent's tagging live and a human's not at
   * all — the "both doors or neither" rule this release states for `link_dto`.
   */
  it('the REST tag doors announce on the same terms as the MCP ones', async () => {
    // Its own entity: `POST /tags` REPLACES the tag set, so running it against
    // the shared `get-users` would silently strip the tags the neighbouring
    // cases assert on.
    await request(t.app)
      .post('/api/endpoints')
      .send({ slug: 'rest-tagged', method: 'GET', path: '/rest-tagged', summary: 'REST tag door' });

    t.broadcasts.length = 0;
    await request(t.app)
      .post('/api/entities/endpoint/rest-tagged/tags')
      .send({ tags: ['rest-door'] })
      .expect(200);
    expect(events()).toEqual([
      { kind: 'entity:changed', entityType: 'endpoint', slug: 'rest-tagged', action: 'update' },
      { kind: 'tag:changed', slug: 'rest-door', action: 'update' },
    ]);

    t.broadcasts.length = 0;
    await request(t.app).delete('/api/entities/endpoint/rest-tagged/tags/rest-door').expect(200);
    expect(events()).toEqual([
      { kind: 'entity:changed', entityType: 'endpoint', slug: 'rest-tagged', action: 'update' },
      { kind: 'tag:changed', slug: 'rest-door', action: 'update' },
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

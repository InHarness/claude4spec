import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildWorkspaceToolsServer } from './workspace-tools.js';
import type { ListProjectsResult } from '../workspace/list-projects.js';

/**
 * `workspace-tools` was the one MCP server in this directory whose handler had no
 * `try/catch`. A throw out of `listProjects` therefore escaped as an unanswered
 * request rather than an error envelope — from the agent's side, indistinguishable
 * from the server having gone silent (brief `0-2-23-to-next`).
 */
describe('workspace-tools', () => {
  async function connect(listProjects: () => ListProjectsResult): Promise<Client> {
    const { server } = buildWorkspaceToolsServer(listProjects);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return client;
  }

  async function call(client: Client) {
    const res = await client.callTool({ name: 'list_projects', arguments: {} });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    return { isError: res.isError === true, body: JSON.parse(text) as Record<string, unknown> };
  }

  it('answers list_projects with the registry the thunk returns', async () => {
    const client = await connect(() => ({
      projects: [{ id: 'p1', slug: 'app-spec', name: 'App Spec', path: '/tmp/app-spec' }],
    }) as unknown as ListProjectsResult);

    const { isError, body } = await call(client);

    expect(isError).toBe(false);
    expect(body).toEqual({
      projects: [{ id: 'p1', slug: 'app-spec', name: 'App Spec', path: '/tmp/app-spec' }],
    });
  });

  it('turns a throwing registry read into an error envelope, not an unanswered request', async () => {
    const client = await connect(() => {
      throw Object.assign(new Error('workspace registry unreadable'), { code: 'REGISTRY_READ' });
    });

    const { isError, body } = await call(client);

    // The call ANSWERS — that is the whole point. Before the wrapper it did not.
    expect(isError).toBe(true);
    expect(body.code).toBe('REGISTRY_READ');
    expect(body.error).toBe('workspace registry unreadable');
  });

  it('re-reads the registry on every call — the thunk is not a snapshot', async () => {
    let generation = 0;
    const client = await connect(() => {
      generation += 1;
      return { projects: [{ id: `p${generation}`, slug: `s${generation}` }] } as unknown as ListProjectsResult;
    });

    const first = await call(client);
    const second = await call(client);

    expect((first.body.projects as Array<{ id: string }>)[0].id).toBe('p1');
    expect((second.body.projects as Array<{ id: string }>)[0].id).toBe('p2');
  });
});

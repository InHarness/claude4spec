import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildWorkspaceToolsServer } from './workspace-tools.js';
import { listProjects, type ListProjectsResult } from '../workspace/list-projects.js';
import type { WorkspaceRecord } from '../workspace/types.js';
import { SKILL_TOOL_RECORDS } from '../../../tests/helpers/skill-tool-records.js';
import { expectToolMatchesToolRecord } from '../../../tests/helpers/write-tool-records.js';
import { expectOperationMatchesRecord } from '../../../tests/helpers/operation-records.js';

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

  describe('the 2.1.26 records', () => {
    const dirs: string[] = [];
    afterEach(() => {
      for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    });
    function projectDir(config: string): string {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-wt-'));
      dirs.push(dir);
      fs.mkdirSync(path.join(dir, '.claude4spec'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude4spec', 'config.json'), config, 'utf8');
      return dir;
    }
    function workspace(projects: Array<{ id: string; cwd: string }>): WorkspaceRecord {
      return {
        name: 'default',
        mode: 'dev',
        defaultPort: 3000,
        lastOpened: new Date().toISOString(),
        projects: projects.map((p) => ({ ...p, addedAt: new Date().toISOString() })),
      };
    }

    it('[entity:workspace-tools-list-projects] workspace-tools · list_projects: name, description and no parameters as the record states them, no hints; answers { workspace, projects: [{ id, name?, description? }] } from the registry, an unreadable config.json gives an entry without name and description rather than an error, and no project directory is returned', async () => {
      const { tools } = buildWorkspaceToolsServer(() => ({ workspace: 'default', projects: [] }));
      expect(tools.map((t) => t.name)).toEqual(['list_projects']);
      expectToolMatchesToolRecord(tools[0], SKILL_TOOL_RECORDS['workspace-tools-list-projects']!);

      const marketing = projectDir(JSON.stringify({ name: 'C4S - Marketing', description: 'Marketingowy przekaz projektu C4S.' }));
      const broken = projectDir('{ not json');
      const record = workspace([
        { id: 'marketing', cwd: marketing },
        { id: 'broken', cwd: broken },
      ]);
      const client = await connect(() => listProjects(record));
      const { isError, body } = await call(client);
      expect(isError).toBe(false);
      expect(body).toEqual({
        workspace: 'default',
        projects: [
          { id: 'marketing', name: 'C4S - Marketing', description: 'Marketingowy przekaz projektu C4S.' },
          { id: 'broken' },
        ],
      });
      const text = JSON.stringify(body);
      expect(text).not.toContain(marketing);
      expect(text).not.toContain(broken);
    });

    it('[entity:list-projects] list_projects: workspace, direct, internal/mcp direct, cli n/a and rest n/a with the record\'s reason, no effects, idempotent, no codes, rendered by workspace-tools · list_projects in internal and mcp, addressed by the server\'s workspace (no input)', () => {
      const op = expectOperationMatchesRecord(
        {
          nazwa: 'list_projects',
          zasieg: 'workspace',
          channels: {
            internal: { kind: 'direct' },
            cli: {
              kind: 'na',
              reason: "Komendy nie zaprojektowano; `c4s list-workspaces` czyta rejestr workspace'ów, a nie listę projektów serwera.",
            },
            mcp: { kind: 'direct' },
            rest: { kind: 'na', reason: 'odłożone do fazy 2 — trasy tej operacji jeszcze nie zbudowano' },
          },
          efekty: ['none'],
          idempotencja: true,
          opisTresci: undefined,
          kodyBledow: [],
          narzedzia: { internal: ['workspace-tools-list-projects'], mcp: ['workspace-tools-list-projects'] },
        },
        SKILL_TOOL_RECORDS,
      );
      expect(op.opClass).toBe('read');
      // The caller does not name the workspace: it is the server process's.
      expect(op.inputSchema).toEqual({});
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../../src/server/core/plugin-host/register-builtins.js';
import { loadBuiltinEnvelopes } from '../../../src/server/core/plugin-host/loader.js';
import { FileWatchRuntime } from '../../../src/server/fs/watcher.js';
import { WsGateway } from '../../../src/server/ws/gateway.js';
import { ProjectContextCache } from '../../../src/server/workspace/context-cache.js';
import { projectDispatchMiddleware } from '../../../src/server/workspace/middleware.js';
import { buildProjectContext } from '../../../src/server/workspace/project-context.js';
import { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import { bootstrapProject } from '../../../src/server/workspace/bootstrap.js';
import type { ProjectRecord, WorkspaceRecord } from '../../../src/server/workspace/types.js';

/**
 * 2.1.12 — M31 edge cases that need a REAL `ProjectContext`: the build the
 * server runs (`buildProjectContext`), behind the same cache and the same
 * `/api/projects/:id` dispatch middleware `startServer` mounts. Only the process
 * plumbing around it (registry home, gateway, watch runtime) is local to the test.
 */
describe('ProjectContext — M31 edge cases on a real build', () => {
  let home: string;
  let prevHome: string | undefined;
  let registry: WorkspaceRegistry;
  let workspace: WorkspaceRecord;
  let cache: ProjectContextCache;
  let app: express.Express;
  let httpServer: http.Server;
  let watchRuntime: FileWatchRuntime;
  /** A project that commits a project-local plugin whose code must never run here. */
  let untrusted: ProjectRecord;
  let untrustedCwd: string;
  /** Written by the committed plugin's entry module the moment it is imported. */
  let sentinel: string;
  /** A project whose owner explicitly answered "no" to the trust prompt. */
  let refused: ProjectRecord;

  function commitLocalPlugin(cwd: string): string {
    const dir = path.join(cwd, '.claude4spec', 'plugins', 'local-untrusted');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: '@local/untrusted', version: '1.0.0', type: 'module', main: 'index.js' }),
    );
    const ran = path.join(dir, 'RAN');
    fs.writeFileSync(
      path.join(dir, 'index.js'),
      [
        "import fs from 'node:fs';",
        `fs.writeFileSync(${JSON.stringify(ran)}, 'project-local plugin code executed');`,
        "export default { name: '@local/untrusted', version: '1.0.0', hostApiVersion: '1', entities: [] };",
      ].join('\n'),
    );
    return ran;
  }

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-ctx-m31-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = path.join(home, 'registry');
    registry = new WorkspaceRegistry(process.env.C4S_HOME);
    workspace = registry.selectOrCreate({ name: 'default' });

    untrustedCwd = path.join(home, 'untrusted-project');
    untrusted = bootstrapProject(registry, workspace, untrustedCwd).project;
    sentinel = commitLocalPlugin(untrustedCwd);

    const refusedCwd = path.join(home, 'refused-project');
    refused = bootstrapProject(registry, workspace, refusedCwd).project;
    commitLocalPlugin(refusedCwd);
    registry.setProjectTrust(workspace, refused.id, false);
    workspace = registry.getWorkspace('default')!;

    const pluginRegistry = new PluginRegistryImpl();
    registerAllPlugins(pluginRegistry);
    const envelopeLoad = await loadBuiltinEnvelopes(pluginRegistry);
    httpServer = http.createServer();
    const gateway = new WsGateway(httpServer, () => true);
    watchRuntime = new FileWatchRuntime({ broadcaster: { broadcast: () => {} } });

    cache = new ProjectContextCache((project) =>
      buildProjectContext({
        registry,
        pluginRegistry,
        pluginRecords: envelopeLoad.records,
        workspace,
        projectId: project.id,
        cwd: project.cwd,
        gateway,
        watchRuntime,
        mode: 'prod',
      }),
    );
    app = express();
    app.use(express.json());
    app.use('/api/projects/:id', projectDispatchMiddleware(registry, workspace, cache));
  }, 60_000);

  afterAll(async () => {
    await cache.disposeAll();
    httpServer.close();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('[ac:ac-projekt-bez-zgody-trustprojectplugins] a project without trustProjectPlugins consent, with committed project-local plugins, opens and serves without error', async () => {
    // Undecided (the trust prompt was never answered) and explicitly refused.
    expect(registry.getProjectTrust(workspace, untrusted.id)).toBeUndefined();
    expect(registry.getProjectTrust(workspace, refused.id)).toBe(false);

    for (const project of [untrusted, refused]) {
      const base = `/api/projects/${project.id}`;

      // Opens: the context builds — no PROJECT_BUILD_FAILED on the first request.
      const meta = await request(app).get(`${base}/meta`);
      expect(meta.status).toBe(200);

      // The committed plugin is reported, not loaded: the client sees it and
      // can raise the trust prompt; the project itself is unaffected.
      const plugins = await request(app).get(`${base}/_meta/plugins`);
      expect(plugins.status).toBe(200);
      expect(plugins.body.localPluginsPresent).toBe(true);
      expect(plugins.body.trust).toBe(project === refused ? false : undefined);
      const local = (plugins.body.packages as Array<{ package: string; code?: string; trust?: string; layer?: string }>).find(
        (p) => p.package === 'local-untrusted',
      );
      expect(local).toMatchObject({ code: 'PLUGIN_PROJECT_UNTRUSTED', trust: 'untrusted', layer: 'overlay' });

      // Serves: the ordinary project endpoints answer normally.
      const tags = await request(app).get(`${base}/tags`);
      expect(tags.status).toBe(200);
      const entities = await request(app).get(`${base}/_meta/entities`);
      expect(entities.status).toBe(200);
    }

    // No code of the committed plugin ran on this machine.
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it('the MCP servers of a project context live as long as the context instance and are released with its dispose', async () => {
    const first = await cache.get(untrusted);
    const names = first.pluginHost.buildMcpServers().map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['page-tools', 'entity-tools', 'reference-tools', 'release-tools']));

    // Dispose of the context (the purge path awaits it) releases them with it.
    await cache.retire(untrusted.id);
    expect(first.pluginHost.buildMcpServers()).toEqual([]);

    // The successor is a new instance with its own servers — nothing was carried
    // over from, or left behind by, its predecessor.
    const second = await cache.get(untrusted);
    expect(second).not.toBe(first);
    expect(second.pluginHost).not.toBe(first.pluginHost);
    expect(second.pluginHost.buildMcpServers().map((s) => s.name)).toEqual(expect.arrayContaining(['page-tools']));
    expect(first.pluginHost.buildMcpServers()).toEqual([]);
  });
});

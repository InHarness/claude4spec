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
import { errorHandler } from '../../../src/server/routes/errors.js';
import type { ProjectRecord, WorkspaceRecord } from '../../../src/server/workspace/types.js';

/**
 * 2.1.60 — M29 `m29cel001` / `m29idx001`: the entity index is derived from the
 * committed files and rebuilt at EVERY context build — not lazily once per
 * project — and the build awaits it, so a project's REST never answers from an
 * index that is not there yet. A REAL `buildProjectContext` behind the same
 * cache and `/api/projects/:id` dispatch the server mounts.
 */
describe('M29 — the entity index is rebuilt by every context build', () => {
  let home: string;
  let prevHome: string | undefined;
  let registry: WorkspaceRegistry;
  let workspace: WorkspaceRecord;
  let cache: ProjectContextCache;
  let app: express.Express;
  let httpServer: http.Server;
  /** The project whose REST writes the entity files. */
  let source: ProjectRecord;

  const ENTITIES = path.join('.claude4spec', 'entities');

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-m29-index-build-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = path.join(home, 'registry');
    registry = new WorkspaceRegistry(process.env.C4S_HOME);
    workspace = registry.selectOrCreate({ name: 'default' });
    source = bootstrapProject(registry, workspace, path.join(home, 'source-project')).project;
    workspace = registry.getWorkspace('default')!;

    const pluginRegistry = new PluginRegistryImpl();
    registerAllPlugins(pluginRegistry);
    const envelopeLoad = await loadBuiltinEnvelopes(pluginRegistry);
    httpServer = http.createServer();
    const gateway = new WsGateway(httpServer, () => true);
    const watchRuntime = new FileWatchRuntime({ broadcaster: { broadcast: () => {} } });
    const frontendBase = { workspacePackages: [], envelopes: [], resolveWorkspaceRoot: () => null };
    cache = new ProjectContextCache((project) =>
      buildProjectContext({
        registry,
        pluginRegistry,
        pluginRecords: envelopeLoad.records,
        frontendBase,
        workspace: registry.getWorkspace('default')!,
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
    app.use('/api', errorHandler);
  }, 60_000);

  afterAll(async () => {
    await cache.disposeAll();
    httpServer.close();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** A project whose committed entity files are a copy of `source`'s, and whose index was never built. */
  function cloneOfSource(name: string): ProjectRecord {
    const cwd = path.join(home, name);
    const project = bootstrapProject(registry, registry.getWorkspace('default')!, cwd).project;
    fs.cpSync(path.join(source.cwd, ENTITIES), path.join(cwd, ENTITIES), { recursive: true });
    return project;
  }

  it('[ac:ac-m29-entityindexerservice-indexall-je] the first REST request to a project never gets its answer from an empty index', async () => {
    const created = await request(app).post(`/api/projects/${source.id}/acs`).send({ title: 'the list is ordered' });
    expect(created.status).toBe(201);
    const slug = created.body.data.slug as string;
    expect(fs.existsSync(path.join(source.cwd, ENTITIES, 'ac', `${slug}.json`))).toBe(true);

    // A fresh clone: the files are committed, its database has never held a row.
    const clone = cloneOfSource('fresh-clone');

    // Its very first requests — the list and the detail — already see the entity.
    const list = await request(app).get(`/api/projects/${clone.id}/acs`);
    expect(list.status).toBe(200);
    expect((list.body.data as Array<{ slug: string }>).map((e) => e.slug)).toContain(slug);
    const one = await request(app).get(`/api/projects/${clone.id}/acs/${slug}`);
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ slug, title: 'the list is ordered' });
  });

  it('[section:m29cel001] [section:m29idx001] an index damaged after a build is repaired by the next context build, not left as built once', async () => {
    const created = await request(app).post(`/api/projects/${source.id}/acs`).send({ title: 'the rule holds' });
    expect(created.status).toBe(201);
    const slug = created.body.data.slug as string;

    const ctx = await cache.get(source);
    // The index loses the row while the file stays: what a failure before the
    // reindex leaves behind.
    ctx.db.handle.prepare('DELETE FROM ac WHERE slug = ?').run(slug);
    expect((await request(app).get(`/api/projects/${source.id}/acs/${slug}`)).status).toBe(404);

    // The next build of the same project rebuilds the index from the files.
    await cache.retire(source.id);
    const rebuilt = await request(app).get(`/api/projects/${source.id}/acs/${slug}`);
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body.data).toMatchObject({ slug, title: 'the rule holds' });
    expect(await cache.get(source)).not.toBe(ctx);
  });
});

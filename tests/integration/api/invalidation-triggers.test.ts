import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../../src/server/core/plugin-host/register-builtins.js';
import { loadBuiltinEnvelopes, type PluginLoadRecord } from '../../../src/server/core/plugin-host/loader.js';
import { FileWatchRuntime } from '../../../src/server/fs/watcher.js';
import { WsGateway } from '../../../src/server/ws/gateway.js';
import { ProjectContextCache, type ProjectBuildStateChange } from '../../../src/server/workspace/context-cache.js';
import { projectDispatchMiddleware } from '../../../src/server/workspace/middleware.js';
import { buildProjectContext, type ProjectContext } from '../../../src/server/workspace/project-context.js';
import { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import { bootstrapProject } from '../../../src/server/workspace/bootstrap.js';
import { builtinRoot, configPath, readConfig } from '../../../src/server/config.js';
import type { ActiveAdapter } from '../../../src/server/routes/agent-turn.js';
import type { PluginManifest } from '../../../src/shared/plugin-host/manifest.js';
import type { ProjectRecord, WorkspaceRecord } from '../../../src/server/workspace/types.js';

/**
 * 2.1.60 — the invalidation triggers (M13 `m13actv0` / `mbladez6`, M33
 * `m33trst0`) on a REAL `ProjectContext`: the build the server runs
 * (`buildProjectContext`), behind the cache and the `/api/projects/:id`
 * dispatch `startServer` mounts, with the context's invalidation hook wired to
 * `cache.invalidate` exactly as there. Each trigger rebuilds the context at
 * once — the tests send no request after the trigger and wait for the new
 * context — inside the same process.
 */
describe('M13/M33 — invalidation triggers rebuild the context at once', () => {
  let home: string;
  let prevHome: string | undefined;
  let registry: WorkspaceRegistry;
  let workspace: WorkspaceRecord;
  let pluginRegistry: PluginRegistryImpl;
  let pluginRecords: PluginLoadRecord[];
  let httpServer: http.Server;
  let gateway: WsGateway;
  let watchRuntime: FileWatchRuntime;
  let cache: ProjectContextCache | undefined;
  let app: express.Express;
  let seq = 0;
  const OWN_RESOURCES = '@c4s-fixture/own-resources';
  const baseOnUnregister = vi.fn();

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-invalidation-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = path.join(home, 'registry');
    registry = new WorkspaceRegistry(process.env.C4S_HOME);
    registry.selectOrCreate({ name: 'default' });
    pluginRegistry = new PluginRegistryImpl();
    registerAllPlugins(pluginRegistry);
    pluginRecords = (await loadBuiltinEnvelopes(pluginRegistry)).records;
    // A base package holding resources of its own: its `onUnregister` belongs to
    // the pool's composition (axis B), never to a context's lifecycle.
    pluginRegistry.registerPlugin({
      name: OWN_RESOURCES,
      version: '1.0.0',
      hostApiVersion: '^2.0.0',
      onUnregister: baseOnUnregister,
      contributes: {
        commands: [{ name: 'own-resources-insert', trigger: 'own', label: 'Insert own', popoverKind: 'own' }],
      },
    } as PluginManifest);
    httpServer = http.createServer();
    gateway = new WsGateway(httpServer, () => true);
    watchRuntime = new FileWatchRuntime({ broadcaster: { broadcast: () => {} } });
  }, 60_000);

  afterEach(async () => {
    await cache?.disposeAll();
    cache = undefined;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await watchRuntime.close();
    await gateway.close();
    httpServer.close();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** A fresh project and the server's composition around it: cache + dispatch, hooks wired as in `startServer`. */
  function setup(prepare?: (cwd: string) => void): ProjectRecord {
    const cwd = path.join(home, `project-${++seq}`);
    fs.mkdirSync(cwd, { recursive: true });
    prepare?.(cwd);
    workspace = registry.getWorkspace('default')!;
    const project = bootstrapProject(registry, workspace, cwd).project;
    workspace = registry.getWorkspace('default')!;
    const c: ProjectContextCache = new ProjectContextCache((p, signal) =>
      buildProjectContext({
        registry,
        pluginRegistry,
        pluginRecords,
        frontendBase: { workspacePackages: [], envelopes: [], resolveWorkspaceRoot: () => null },
        workspace,
        projectId: p.id,
        cwd: p.cwd,
        gateway,
        watchRuntime,
        mode: 'prod',
        signal,
        onTurnFinished: () => c.reapIdle(),
        onContextConfigChanged: (opts) => c.invalidate(p.id, opts),
      }),
    );
    cache = c;
    app = express();
    app.use(express.json());
    app.use('/api/projects/:id', projectDispatchMiddleware(registry, workspace, c));
    return project;
  }

  /** The project's next context — waited for WITHOUT sending a request. */
  async function rebuiltAfter(project: ProjectRecord, previous: ProjectContext): Promise<ProjectContext> {
    await vi.waitFor(
      () => {
        const live = cache!.getLive(project.id);
        expect(live).not.toBeNull();
        expect(live).not.toBe(previous);
      },
      { timeout: 30_000, interval: 25 },
    );
    return cache!.getLive(project.id)!;
  }

  /** A type to switch off: `diagram` (a built-in direct module nothing depends on) when active. */
  function typeToDrop(active: string[]): string {
    return active.includes('diagram') ? 'diagram' : active[active.length - 1]!;
  }

  it('[ac:ac-aktywacja-bez-restartu-procesu-zmiana] [section:m13actv0] [section:mbladez6] PATCH /api/config { entities } rebuilds the ProjectContext with the new set of types at once — no request after the save, the same process', async () => {
    const project = setup();
    const base = `/api/projects/${project.id}`;
    const before = await cache!.get(project);
    const active = before.pluginHost.partition().active;
    expect(active.length).toBeGreaterThan(1);
    const dropped = typeToDrop(active);
    const states: ProjectBuildStateChange[] = [];
    cache!.onStateChange((change) => states.push(change));

    const res = await request(app).patch(`${base}/config`).send({ entities: active.filter((t) => t !== dropped) });
    expect(res.status).toBe(200);
    // The file is written: the activation is the config's.
    expect(readConfig(project.cwd).entities).not.toContain(dropped);

    // The rebuild started from the invalidation itself — no request was sent.
    const after = await rebuiltAfter(project, before);
    expect(states.map((s) => s.state)).toEqual(['queued', 'building', 'ready']);
    // `consolidate` + `mountBackend` with the new set: the type is inactive now.
    const partition = after.pluginHost.partition();
    expect(partition.active).not.toContain(dropped);
    expect(partition.inactive).toContain(dropped);
    expect(partition.active).toEqual(active.filter((t) => t !== dropped));
    // Served by the same process, through the same dispatch.
    const meta = await request(app).get(`${base}/_meta/entities`);
    expect(meta.status).toBe(200);
    expect(meta.body.active).not.toContain(dropped);
    expect(meta.body.inactive).toContain(dropped);
  }, 90_000);

  it('[ac:ac-tura-w-locie-w-chwili-zmiany-config-e] [section:m13actv0] a turn in flight when config.entities changes ends on the context from before the change; that context is released once the turn ends', async () => {
    const project = setup();
    const before = await cache!.get(project);
    const active = before.pluginHost.partition().active;
    const dropped = typeToDrop(active);
    const dispose = vi.spyOn(before, 'dispose');
    // A turn in flight holds the context it captured (the turn registry is the
    // one `hasInFlightTurn` reads).
    before.activeAdapters.set('turn-in-flight', {} as ActiveAdapter);

    await request(app)
      .patch(`/api/projects/${project.id}/config`)
      .send({ entities: active.filter((t) => t !== dropped) })
      .expect(200);
    const after = await rebuiltAfter(project, before);

    // The new context has the new set; the turn's context still has the old one
    // and is not released under the turn.
    expect(after.pluginHost.partition().active).not.toContain(dropped);
    expect(before.pluginHost.partition().active).toContain(dropped);
    expect(before.pluginHost.partition().active).toEqual(active);
    expect(dispose).not.toHaveBeenCalled();

    // The turn ends (its `finally` → `onTurnFinished`): the old context goes.
    before.activeAdapters.delete('turn-in-flight');
    cache!.reapIdle();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cache!.getLive(project.id)).toBe(after);
  }, 90_000);

  it('[section:m13plenv] the dispose of a ProjectContext (its invalidation and release) does not call a base plugin\'s onUnregister — the host releases the context, the pool keeps the plugin', async () => {
    const project = setup();
    const before = await cache!.get(project);
    const active = before.pluginHost.partition().active;
    const dispose = vi.spyOn(before, 'dispose');

    await request(app)
      .patch(`/api/projects/${project.id}/config`)
      .send({ entities: active.filter((t) => t !== typeToDrop(active)) })
      .expect(200);
    const after = await rebuiltAfter(project, before);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    await dispose.mock.results[0]!.value;

    expect(baseOnUnregister).not.toHaveBeenCalled();
    expect(pluginRegistry.listPluginRecords().map((r) => r.name)).toContain(OWN_RESOURCES);
    expect(after.pluginHost.listCommands().map((c) => c.name)).toContain('own-resources-insert');
  }, 90_000);

  it('[ac:ac-user-edytuje-config-json-przy-uruchomi] a hand edit of config.json while the server runs does not rebuild the ProjectContext', async () => {
    const project = setup();
    const ctx = await cache!.get(project);
    await ctx.bootSettled;
    const active = ctx.pluginHost.partition().active;
    const dropped = typeToDrop(active);
    const states: ProjectBuildStateChange[] = [];
    cache!.onStateChange((change) => states.push(change));
    const broadcast = vi.spyOn(gateway, 'broadcast');
    // Let the watch providers of the context finish their first listing.
    await new Promise((r) => setTimeout(r, 200));

    // The hand edit: the same field the settings save writes, outside the app.
    const file = configPath(project.cwd);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    raw.entities = active.filter((t) => t !== dropped);
    fs.writeFileSync(file, JSON.stringify(raw, null, 2));
    // Then a watched change, written AFTER the edit: once the watcher has
    // delivered it, it has had every chance to deliver the config edit too.
    const pagesDir = path.join(project.cwd, builtinRoot(readConfig(project.cwd).roots).dir);
    fs.writeFileSync(path.join(pagesDir, 'probe-after-config-edit.md'), '# Probe\n');
    await vi.waitFor(
      () =>
        expect(broadcast).toHaveBeenCalledWith(
          project.id,
          expect.objectContaining({ kind: 'file:changed', path: 'probe-after-config-edit.md' }),
        ),
      { timeout: 15_000, interval: 25 },
    );

    // No invalidation, no rebuild: the same context, with the set it was built on.
    expect(states).toEqual([]);
    expect(cache!.getLive(project.id)).toBe(ctx);
    expect(ctx.pluginHost.partition().active).toEqual(active);
    const meta = await request(app).get(`/api/projects/${project.id}/_meta/entities`);
    expect(meta.body.active).toContain(dropped);
    expect(broadcast).not.toHaveBeenCalledWith(project.id, expect.objectContaining({ kind: 'project:disposed' }));
  }, 90_000);

  it('[section:m33trst0] setProjectTrust in the server process (the trust-prompt answer) rebuilds the context at once — with the overlay after a grant, without it after a revoke', async () => {
    const project = setup((cwd) => {
      const dir = path.join(cwd, '.claude4spec', 'plugins', 'local-cmd');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: '@local/cmd', version: '1.0.0', type: 'module', main: 'index.js' }),
      );
      fs.writeFileSync(
        path.join(dir, 'index.js'),
        `export const manifest = ${JSON.stringify({
          name: '@local/cmd',
          version: '1.0.0',
          hostApiVersion: '^2.0.0',
          contributes: {
            commands: [{ name: 'local-insert', trigger: 'loc', label: 'Insert local', popoverKind: 'loc' }],
          },
        })};\n`,
      );
    });
    const base = `/api/projects/${project.id}`;
    const overlayRecord = (ctx: ProjectContext) => ctx.overlayRecords?.find((r) => r.package === 'local-cmd');

    const untrusted = await cache!.get(project);
    expect(overlayRecord(untrusted)).toMatchObject({ code: 'PLUGIN_PROJECT_UNTRUSTED', trust: 'untrusted' });

    // Grant: the answer persists the flag and the context rebuilds with the overlay.
    await request(app).post(`${base}/trust-plugins`).send({ trust: true }).expect(200);
    expect(registry.getProjectTrust(registry.getWorkspace('default')!, project.id)).toBe(true);
    const trusted = await rebuiltAfter(project, untrusted);
    expect(overlayRecord(trusted)).toMatchObject({ status: 'loaded', layer: 'overlay' });
    const commands = await request(app).get(`${base}/_meta/plugin-commands`);
    expect((commands.body.commands as Array<{ name: string }>).map((c) => c.name)).toContain('local-insert');

    // Revoke: rebuilt again at once, on the base alone.
    await request(app).post(`${base}/trust-plugins`).send({ trust: false }).expect(200);
    const revoked = await rebuiltAfter(project, trusted);
    expect(overlayRecord(revoked)).toMatchObject({ code: 'PLUGIN_PROJECT_UNTRUSTED' });
    expect(revoked.pluginHost.listCommands().map((c) => c.name)).not.toContain('local-insert');
  }, 90_000);
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { loadBuiltinEnvelopes } from '../../../src/server/core/plugin-host/loader.js';
import { FileWatchRuntime, type MountSourceOptions, type WatchScope } from '../../../src/server/fs/watcher.js';
import { WsGateway } from '../../../src/server/ws/gateway.js';
import { ProjectContextCache } from '../../../src/server/workspace/context-cache.js';
import { buildProjectContext } from '../../../src/server/workspace/project-context.js';
import { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import { bootstrapProject } from '../../../src/server/workspace/bootstrap.js';
import type { PluginLoadRecord } from '../../../src/server/core/plugin-host/loader.js';
import type { ProjectRecord } from '../../../src/server/workspace/types.js';

/**
 * 2.1.60 — M31 `m31ctx001`: the process shutdown during a build interrupts it,
 * and the resources the partial build acquired are released in reverse order of
 * acquisition. A REAL `buildProjectContext` behind the cache the server uses:
 * the shutdown (`cache.disposeAll()`) is triggered from inside the build, at its
 * first watch mount — after the database handle opened.
 */
describe('M31 — the shutdown during a context build', () => {
  let home: string;
  let prevHome: string | undefined;
  let registry: WorkspaceRegistry;
  let pluginRegistry: PluginRegistryImpl;
  let pluginRecords: PluginLoadRecord[];
  let httpServer: http.Server;
  let gateway: WsGateway;
  let watchRuntime: FileWatchRuntime;
  let project: ProjectRecord;

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-m31-shutdown-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = path.join(home, 'registry');
    registry = new WorkspaceRegistry(process.env.C4S_HOME);
    const workspace = registry.selectOrCreate({ name: 'default' });
    project = bootstrapProject(registry, workspace, path.join(home, 'project')).project;
    pluginRegistry = new PluginRegistryImpl();
    pluginRecords = (await loadBuiltinEnvelopes(pluginRegistry)).records;
    httpServer = http.createServer();
    gateway = new WsGateway(httpServer, () => true);
    watchRuntime = new FileWatchRuntime({ broadcaster: { broadcast: () => {} } });
  }, 60_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await watchRuntime.close();
    await gateway.close();
    httpServer.close();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('[ac:ac-zamkniecie-procesu-w-trakcie-budowy-z] the process shutdown during a build releases the resources of the partial build — its watch mounts, then its database handle', async () => {
    const workspace = registry.getWorkspace('default')!;
    const dbPath = path.resolve(registry.slotDir(workspace, project.id), 'db.sqlite');
    const cache = new ProjectContextCache((p, signal) =>
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
      }),
    );

    /** What the partial build acquired and released, in order. */
    const events: string[] = [];
    const mounted: Array<{ source: string; scope: WatchScope }> = [];
    let shutdown: Promise<void> | undefined;
    const mountSource = watchRuntime.mountSource.bind(watchRuntime);
    vi.spyOn(watchRuntime, 'mountSource').mockImplementation((opts: MountSourceOptions & { scope: WatchScope }) => {
      mountSource(opts);
      if (!opts.scope.startsWith(`context:${project.id}#`)) return;
      mounted.push({ source: opts.source, scope: opts.scope });
      // The process is closed while this build is under way (after its db opened).
      shutdown ??= cache.disposeAll();
    });
    const disposeScope = watchRuntime.disposeScope.bind(watchRuntime);
    vi.spyOn(watchRuntime, 'disposeScope').mockImplementation(async (scope: WatchScope) => {
      if (scope.startsWith(`context:${project.id}#`)) events.push('watch scope released');
      return disposeScope(scope);
    });
    const close = Database.prototype.close;
    vi.spyOn(Database.prototype, 'close').mockImplementation(function (this: Database.Database) {
      if (path.resolve(this.name) === dbPath) events.push('db handle closed');
      return close.call(this);
    });

    const request = cache.get(project).then(
      () => 'served',
      (err: Error) => err.message,
    );
    while (!shutdown) await new Promise((resolve) => setImmediate(resolve));
    await shutdown;

    // The build never became a context: the request was refused, the cache holds nothing.
    expect(await request).toBe('the server is shutting down');
    expect(cache.getLive(project.id)).toBeNull();
    expect(cache.readStates().size).toBe(0);
    // Its resources are released — the watch mounts before the db handle (reverse acquisition).
    expect(events).toEqual(['watch scope released', 'db handle closed']);
    expect(mounted.length).toBeGreaterThan(0);
    for (const m of mounted) expect(watchRuntime.isMounted(m.source, m.scope)).toBe(false);
  }, 60_000);
});

/**
 * 2.1.20 (M33 `ywud56l6`) — the host repo's internal, unpublished test setup for
 * the built-in envelopes.
 *
 * A built-in envelope's tests (`plugins/<name>/test/**`) reach a running host
 * only through here, by the alias `@c4s-internal/plugin-test-setup` that the
 * root `vitest.config.ts` and each envelope's own `vitest.config.ts` resolve to
 * this file. Host tests import it by its path.
 *
 * Not a contract: the package neither ships nor exports it (`files` has no
 * `tests/`, `exports` has no `./plugin-testing` — the published harness of
 * 2.1.17 is withdrawn; M33 `m33l11sc` keeps it as an intent, not a contract),
 * and a plugin outside the repository has no counterpart today. Moving an
 * envelope out of the repo changes no import in its tests (the alias stays), but
 * the tests have to be re-wired to whatever the host publishes by then.
 *
 * `createPluginTestApp(manifests)` stands a REAL host up in this process on a
 * throwaway project. Fidelity, and where it stops:
 *   - every manifest registers through `registry.registerPlugin(manifest)` — the
 *     registration point and fan-out the loader uses — next to the directly
 *     built-in types and the built-in envelopes (`registerAllPlugins`, then
 *     `loadBuiltinEnvelopes`), exactly as `startServer` lays the catalog out;
 *   - the project context is built by `buildProjectContext`, the runtime's own
 *     build, not by a test-only composition;
 *   - the host-owned `@c4s/plugin-runtime` resolver is installed the way the
 *     loader installs it (same latch, same fallback when the runtime has no
 *     module hooks);
 *   - NOT reproduced: discovery, the dynamic import of a package, the
 *     `hostApiVersion` / `engines` gate, the trust gate, hot reload.
 *
 * Lifetime: one instance = one temporary project with its own context, db handle
 * and broadcast buffer. `createPluginTestApp` returns once the context's
 * background boot work has settled, and `cleanup()` disposes the context
 * (watchers, MCP factories, db handle) and only then removes the temporary
 * directory — nothing of the instance runs or logs after it resolves. The db
 * handle is for test assertions only and is never put on a plugin's
 * `MountContext`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type Database from 'better-sqlite3';
import type { PluginManifest } from '../../src/shared/plugin-host/manifest.js';
import type { WsEvent } from '../../src/shared/types.js';
import { PluginRegistryImpl } from '../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../src/server/core/plugin-host/register-builtins.js';
import { loadBuiltinEnvelopes, type PluginLoadRecord } from '../../src/server/core/plugin-host/loader.js';
import { installPluginRuntimeResolver } from '../../src/server/core/plugin-host/plugin-runtime-resolver.js';
import type { CrudFacade, ProjectPluginHost } from '../../src/server/core/plugin-host/types.js';
import { FileWatchRuntime } from '../../src/server/fs/watcher.js';
import { errorHandler } from '../../src/server/routes/errors.js';
import { bootstrapProject } from '../../src/server/workspace/bootstrap.js';
import { buildProjectContext } from '../../src/server/workspace/project-context.js';
import { WorkspaceRegistry } from '../../src/server/workspace/registry.js';
import type { WsGateway } from '../../src/server/ws/gateway.js';

// Same resolver, same latch as the loader (`loadWorkspacePlugins`). At module
// evaluation, not only in `createPluginTestApp`: the manifests are the harness's
// INPUT, so the plugin module that exports them is imported before the call —
// and its bare `@c4s/plugin-runtime` import has to resolve by then.
installPluginRuntimeResolver();

/** Workspace name of every harness registry — each instance has its own home. */
const HARNESS_WORKSPACE = 'plugin-test';

export interface PluginTestApp {
  /** The HTTP application: the project's routes under `baseUrl`, as the server mounts them. */
  app: express.Express;
  /** The temporary project's stored id. */
  projectId: string;
  /** `/api/projects/<projectId>` — the prefix every project route (and a plugin frontend's fetch) uses. */
  baseUrl: string;
  /** Entity CRUD — the same write door the plugin's `MountContext.crud` is. */
  crud: CrudFacade;
  /** The project's plugin host facade (activation, entity modules, services). */
  host: ProjectPluginHost;
  /** The temporary project's working directory. */
  cwd: string;
  /** The project database — for test assertions only; never on a plugin's `MountContext`. */
  db: Database.Database;
  /** Every WS event the project broadcast, in order. Clear it with `broadcasts.length = 0`. */
  broadcasts: WsEvent[];
  /**
   * Disposes the context (watchers, MCP factories, db handle) and only then removes
   * the temporary directory. When it resolves nothing of this instance is running
   * or logging. Idempotent.
   */
  cleanup: () => Promise<void>;
}

/**
 * Stand a host up in this process on a temporary project, with `manifests`
 * registered next to the built-in types and envelopes and active without any
 * configuration (the project carries no `config.entities` whitelist, so every
 * available type is active — built-ins keep their default activation).
 *
 * A manifest the registration point rejects is rejected here with the SAME
 * error `registry.registerPlugin` raises under the loader (the loader records
 * that error's message as `PLUGIN_INVALID_MANIFEST`); nothing is left on disk.
 */
export async function createPluginTestApp(manifests: PluginManifest[]): Promise<PluginTestApp> {
  installPluginRuntimeResolver();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-plugin-test-'));
  const removeTmp = () => fs.rmSync(tmp, { recursive: true, force: true });

  try {
    // The process-wide catalog, laid out as `startServer` lays it out: directly
    // built-in types, then the built-in envelopes, then the packages — here, the
    // manifests under test, through the loader's registration point.
    const pluginRegistry = new PluginRegistryImpl();
    registerAllPlugins(pluginRegistry);
    const envelopeLoad = await loadBuiltinEnvelopes(pluginRegistry);
    const records: PluginLoadRecord[] = [...envelopeLoad.records];
    for (const manifest of manifests) {
      // Not caught: the registration point's own error IS the harness's answer.
      pluginRegistry.registerPlugin(manifest);
      records.push({
        package: manifest.name,
        status: 'loaded',
        layer: 'base',
        manifestName: manifest.name,
        manifestVersion: manifest.version,
        contributedTypes: (manifest.contributes.entities ?? []).map((e) => e.type),
      });
    }

    // A registry in a throwaway home: the db slot, `workspaces.json` and the
    // project record never touch the developer's `~/.claude4spec`.
    const registry = new WorkspaceRegistry(path.join(tmp, 'home'));
    let workspace = registry.selectOrCreate({ name: HARNESS_WORKSPACE });
    const cwd = path.join(tmp, 'project');
    const { project } = bootstrapProject(registry, workspace, cwd);
    workspace = registry.getWorkspace(HARNESS_WORKSPACE) ?? workspace;

    // Captured broadcasts: the project's room (services, routes, the crud door)
    // and the file-watch runtime's events, in arrival order.
    const broadcasts: WsEvent[] = [];
    const gateway = {
      broadcast: (_projectId: string, event: WsEvent) => void broadcasts.push(event),
      closeRoom: () => {},
    } as unknown as WsGateway;
    const watchRuntime = new FileWatchRuntime({
      broadcaster: { broadcast: (_scope, event) => void broadcasts.push(event) },
    });

    const ctx = await buildProjectContext({
      registry,
      pluginRegistry,
      pluginRecords: records,
      workspace,
      projectId: project.id,
      cwd: project.cwd,
      gateway,
      watchRuntime,
      mode: 'prod',
    });

    // The context's boot passes (section/todos/link indexers, file-version and
    // frontmatter baselines, sidebar rebuild) run in the background; the server
    // serves without waiting. The harness waits: a test starts on a settled
    // project, and no boot pass is still reading the directory when a test that
    // never touched it cleans up right away.
    try {
      await ctx.bootSettled;
    } catch (err) {
      await ctx.dispose().catch(() => {});
      await watchRuntime.close().catch(() => {});
      throw err;
    }

    const baseUrl = `/api/projects/${project.id}`;
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use(baseUrl, ctx.router);
    app.use('/api', errorHandler);

    let cleaned = false;
    return {
      app,
      projectId: project.id,
      baseUrl,
      crud: ctx.crud,
      host: ctx.pluginHost,
      cwd: project.cwd,
      db: ctx.db.handle,
      broadcasts,
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        try {
          // Already settled by the time the instance was handed out; awaited
          // again so the order "background work over → dispose → remove the
          // directory" holds by construction, not by the call above.
          await ctx.bootSettled;
          await ctx.dispose();
          await watchRuntime.close();
        } finally {
          removeTmp();
        }
      },
    };
  } catch (err) {
    removeTmp();
    throw err;
  }
}

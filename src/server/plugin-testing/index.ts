/**
 * `@inharness-ai/claude4spec/plugin-testing` — the plugin test harness (M33 L11,
 * 2.1.17 `m33l11sc`).
 *
 * `createPluginTestApp(manifests)` stands a REAL host up in this process on a
 * throwaway project, for a plugin author's integration tests — including the
 * authors of the built-in envelopes, whose tests reach a running host only
 * through here (`ywud56l6`), never through the host repo's own test helpers.
 *
 * Fidelity, and where it stops:
 *   - every manifest registers through `registry.registerPlugin(manifest)` — the
 *     registration point and fan-out the loader uses — next to the directly
 *     built-in types and the built-in envelopes, exactly as `startServer` lays
 *     the catalog out;
 *   - the project context is built by `buildProjectContext`, the runtime's own
 *     build, not by a test-only composition;
 *   - the host-owned `@c4s/plugin-runtime` resolver is installed the way the
 *     loader installs it (same latch, same published-subpath fallback when the
 *     runtime has no module hooks), so the bare import in plugin code resolves to
 *     THIS host's live values. It is installed when this module is evaluated, so
 *     a plugin module imported after the harness (dynamically, or with the
 *     harness preloaded via `node --import`) resolves the alias too;
 *   - NOT reproduced: discovery, the dynamic import of a package, the
 *     `hostApiVersion` / `engines` gate, the trust gate, hot reload. A green test
 *     here is no proof the package passes the loader's gate.
 *
 * Outside the versioned Host API surface: neither this subpath nor its shape
 * moves `HOST_API_VERSION` — the harness is a matter of the package release
 * (npm semver), like the `experimental` UI-kit components. It pulls server
 * dependencies (express, better-sqlite3, the whole context build), which is why
 * it is a subpath of its own and `…/plugin-runtime` (+ `/ui`) stays dep-free:
 * nothing under `src/server/plugin-runtime/` may import this module.
 *
 * Lifetime (L10): one instance = one temporary project with its own context, db
 * handle and broadcast buffer, keyed by object identity; `cleanup()` disposes the
 * context and removes the temporary directory. Instances in one process share
 * the loader's two process-wide exceptions — the resolver latch (the first
 * instance installs it) and Node's ESM cache (plugin modules are never unloaded
 * between instances).
 *
 * The published types live in `src/plugin-types/plugin-testing.ts`; the db
 * handle returned here is for test assertions only and is never put on a
 * plugin's `MountContext`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type Database from 'better-sqlite3';
import type { PluginManifest } from '../../shared/plugin-host/manifest.js';
import type { WsEvent } from '../../shared/types.js';
import { PluginRegistryImpl } from '../core/plugin-host/registry.js';
import { registerAllPlugins } from '../core/plugin-host/register-builtins.js';
import { loadBuiltinEnvelopes, type PluginLoadRecord } from '../core/plugin-host/loader.js';
import { installPluginRuntimeResolver } from '../core/plugin-host/plugin-runtime-resolver.js';
import type { CrudFacade, ProjectPluginHost } from '../core/plugin-host/types.js';
import { FileWatchRuntime } from '../fs/watcher.js';
import { errorHandler } from '../routes/errors.js';
import { bootstrapProject } from '../workspace/bootstrap.js';
import { buildProjectContext } from '../workspace/project-context.js';
import { WorkspaceRegistry } from '../workspace/registry.js';
import type { WsGateway } from '../ws/gateway.js';

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
  /** Disposes the context (watchers, MCP factories, db handle) and removes the temporary directory. */
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

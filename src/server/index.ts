// M51 — host modules register their XML tags at process start.
import '../shared/xml-markup/host-tags.js';
import express, { type Express } from 'express';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { WsGateway } from './ws/gateway.js';
import { createRoomBroadcaster } from './ws/watch-broadcaster.js';
import { FileWatchRuntime } from './fs/watcher.js';
import { PLUGINS_BASE_SOURCE } from './fs/sources.js';
import { type WorkspaceRegistry, DEFAULT_WORKSPACE_PORT } from './workspace/registry.js';
import { ActivatedProjects, activatingBuild, bootstrapProject } from './workspace/bootstrap.js';
import { readPeerConfigSummary } from './workspace/peer-config.js';
import { checkRequest, hostOriginGuard } from './http/host-origin-guard.js';
import { effectiveBindHost, localServerUrl } from '../core/workspace/network.js';
import { buildProjectContext } from './workspace/project-context.js';
import { ProjectContextCache } from './workspace/context-cache.js';
import { projectDispatchMiddleware } from './workspace/middleware.js';
import { workspaceRouter } from './workspace/routes.js';
import type { WorkspaceRecord } from './workspace/types.js';
import { resolveSpaRoute, spaDocument, type SpaResolution } from './workspace/spa-route.js';
import { PluginRegistryImpl } from './core/plugin-host/registry.js';
import { registerAllPlugins } from './core/plugin-host/register-builtins.js';
import { logRefRegistrationWarnings, refRegistrationWarnings } from './core/plugin-host/ref-warnings.js';
import {
  loadBuiltinEnvelopes,
  loadWorkspacePlugins,
  reloadPlugin,
} from './core/plugin-host/loader.js';
import { basePackageLocator, workspaceNodeModulesDir } from './core/plugin-host/workspace-packages.js';
import { PREDEFINED_PLUGINS, resolvePluginPackages } from './workspace/registry.js';
import { pluginsRouter } from './routes/plugins.js';
import type { FrontendBaseTier } from './core/plugin-host/frontend-assets.js';
import { errorHandler } from './routes/errors.js';
import { buildImportMap } from './core/plugin-host/runtime-shims.js';
import { discoverBuiltinEnvelopes, servableEnvelopes } from './core/plugin-host/builtin-envelopes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface StartOptions {
  /**
   * The directory the launcher was run in (never a project: the start
   * registers none). Only the fallback of the package-root lookup for assets.
   */
  cwd: string;
  /**
   * The launcher's registry (migrated, `src/bin/launch.ts` `prepareStart`).
   * The server serves through it and never opens a second one, so the view's
   * read of a home's `workspace.json` is not repeated.
   */
  registry: WorkspaceRegistry;
  /**
   * 2.1.58 (M31 `ssn335r8`): the workspace VIEW, opened by `registry.openView`
   * before listen — `.claude4spec/.gitignore` ensured, `workspace.json` read
   * and validated once (a WorkspaceFileError refused the start already).
   * Process-lifetime: an outside change to the file applies from the next
   * start, this registry's own writes update it at once.
   */
  workspace: WorkspaceRecord;
  port?: number;
  /**
   * 2.1.0: listen address. Absent ⇒ the workspace's `bindHost` (loopback when
   * unset) — never "all interfaces" by accident.
   */
  host?: string;
  mode?: 'dev' | 'prod';
  /**
   * 2.1.58 (M01 `3ebblo1q`): the `--remote-url` start flag. It overrides
   * `config.remoteApiUrl` of EVERY project of the process for the process
   * lifetime and is never written to a file. Absent ⇒ each project's
   * `config.remoteApiUrl`, then the M24 prod constant (inside RemoteHttpClient).
   */
  remoteApiUrl?: string;
}

export interface ServerHandle {
  url: string;
  port: number;
  shutdown: () => Promise<void>;
}

// M49: the process's default listening port — the same 4500 the workspace
// registry seeds (`DEFAULT_WORKSPACE_PORT`), so a caller that omits `port`
// lands where `c4s` looks for the server.
const DEFAULT_PORT = DEFAULT_WORKSPACE_PORT;

// M01: deterministyczny port. Przy zajetym porcie serwer NIE wskakuje juz na
// `port+1` — failuje z czytelnym bledem i niezerowym exit code. Powod: stały
// port workspace'u jest warunkiem discovery serwera przez `c4s ask`.
async function listenOrExit(server: HttpServer, port: number, host: string): Promise<number> {
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
    // The port actually bound — the requested one, or the ephemeral port the OS
    // picked for `port: 0`.
    const address = server.address();
    return typeof address === 'object' && address ? address.port : port;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `${host}:${port} is in use — stop the other instance or change the workspace port / pass --port`,
      );
      process.exit(1);
    }
    // 2.1.0: `--host` persists in the registry, so an address this machine
    // cannot bind (a typo, a DHCP address that moved) fails EVERY later start
    // too — say how to get back to loopback instead of dumping a stack.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRNOTAVAIL' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      console.error(
        `cannot listen on ${host}:${port} (${code}) — the workspace's listen address is stored in ~/.claude4spec/workspaces.json; pass --host=<addr> to change it, or --host= to return to loopback`,
      );
      process.exit(1);
    }
    throw err;
  }
}

// M33 "Option B": inject the plugin import map into <head> statically (before any
// module script resolves), so a runtime plugin's bare imports (`react`, …) resolve
// to the host's singleton shims. Applied to every SPA page (workspace + project routes).
const IMPORT_MAP_SCRIPT = `<script type="importmap">${JSON.stringify({
  imports: buildImportMap(),
}).replace(/</g, '\\u003c')}</script>`;
function injectImportMap(html: string): string {
  return html.replace('<head>', `<head>${IMPORT_MAP_SCRIPT}`);
}

/**
 * The project identity a served document carries: the project of a `/p/<id>/…`
 * route (opening it records the workspace's last opened project), `null` on a
 * workspace route, which has no project (M50 `1bd92aq2`).
 */
function documentIdentity(deps: SpaDeps, resolution: Exclude<SpaResolution, { kind: 'redirect' }>) {
  if (resolution.kind === 'workspace') return null;
  const { project } = resolution;
  deps.registry.touchLastOpened(deps.workspace.name, project.id);
  return { id: project.id, name: readPeerConfigSummary(project.cwd).name ?? project.id };
}

interface SpaDeps {
  registry: WorkspaceRegistry;
  workspace: WorkspaceRecord;
  /** Only used to locate the repo root (vite config / dist assets). */
  startCwd: string;
}

async function mountDevVite(app: Express, deps: SpaDeps) {
  const { createServer } = await import('vite');
  const repoRoot = findRepoRoot(deps.startCwd);
  const vite = await createServer({
    configFile: path.join(repoRoot, 'vite.config.ts'),
    root: path.join(repoRoot, 'src/client'),
    server: { middlewareMode: true },
    appType: 'custom',
  });
  app.use(vite.middlewares);
  app.use('*', async (req, res, next) => {
    if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/ws')) return next();
    try {
      // req.path inside app.use('*') is the stripped mount path ('/') — the
      // route lives in originalUrl.
      const urlPath = (req.originalUrl ?? '/').split('?')[0]!;
      const resolution = resolveSpaRoute(deps.registry, deps.workspace, urlPath);
      if (resolution.kind === 'redirect') return res.redirect(302, resolution.to);
      const htmlPath = path.join(repoRoot, 'src/client/index.html');
      let html = await fs.promises.readFile(htmlPath, 'utf-8');
      html = await vite.transformIndexHtml(req.originalUrl, html);
      html = injectImportMap(html);
      res
        .status(200)
        .set({ 'Content-Type': 'text/html' })
        .end(spaDocument(html, documentIdentity(deps, resolution)));
    } catch (err) {
      vite.ssrFixStacktrace(err as Error);
      next(err);
    }
  });
  return async () => { await vite.close(); };
}

function mountProd(app: Express, deps: SpaDeps) {
  const repoRoot = findRepoRoot(deps.startCwd);
  const clientDist = path.join(repoRoot, 'dist/client');
  // index:false — '/' must reach the catch-all (302 → /welcome), never a raw un-injected index.html.
  app.use(express.static(clientDist, { index: false }));
  app.use('*', (req, res, next) => {
    if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/ws')) return next();
    try {
      const urlPath = (req.originalUrl ?? '/').split('?')[0]!;
      const resolution = resolveSpaRoute(deps.registry, deps.workspace, urlPath);
      if (resolution.kind === 'redirect') return res.redirect(302, resolution.to);
      const raw = injectImportMap(fs.readFileSync(path.join(clientDist, 'index.html'), 'utf-8'));
      res
        .status(200)
        .set({ 'Content-Type': 'text/html' })
        .end(spaDocument(raw, documentIdentity(deps, resolution)));
    } catch (err) {
      next(err);
    }
  });
  return async () => {};
}

function findRepoRoot(startFrom: string): string {
  let cur = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(cur, 'package.json'))) return cur;
    cur = path.dirname(cur);
  }
  return startFrom;
}

export async function startServer(opts: StartOptions): Promise<ServerHandle> {
  const cwd = opts.cwd;
  const mode = opts.mode ?? (process.env.NODE_ENV === 'production' ? 'prod' : 'dev');
  const portRef = { current: opts.port ?? DEFAULT_PORT };

  // M31: the DB lives in the workspace slot, not the project dir. The launcher
  // migrated the registry, selected the workspace and opened its view before
  // calling here — nothing of it is read again.
  const { registry, workspace } = opts;
  const liveWorkspace = () => {
    const ws = registry.getWorkspace(workspace.name) ?? workspace;
    // The port actually bound wins over the stored default (`port: 0` binds an ephemeral one).
    return { ...ws, defaultPort: portRef.current };
  };

  const app = express();
  // 2.1.0: Host allowlist + Origin check BEFORE every route (and before the
  // project key is read). The WS upgrade runs the same check in the gateway.
  app.use(hostOriginGuard(liveWorkspace));
  app.use(express.json({ limit: '2mb' }));

  // DIAGNOSTIC (perf): true server-side handler duration per /api request. In dev
  // the app and Vite share one origin/event loop, so DevTools "Time" conflates
  // server time with browser connection-queue/stall — this log shows the real
  // handler ms. Gated on C4S_TIMING=1 so it's silent unless explicitly enabled.
  if (process.env.C4S_TIMING === '1') {
    app.use((req, res, next) => {
      if (!req.originalUrl.startsWith('/api')) return next();
      const startedAt = performance.now();
      res.on('finish', () => {
        const ms = Math.round(performance.now() - startedAt);
        console.log(`[timing] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
      });
      next();
    });
  }

  // M31: process-immutable plugin catalog, populated exactly once.
  const pluginRegistry = new PluginRegistryImpl();
  registerAllPlugins(pluginRegistry);
  // M33: load workspace-declared npm plugin packages onto the same catalog,
  // before any ProjectContext consolidates against it. Per-package failures are
  // isolated (skipped/failed records) — one bad plugin never crashes bootstrap.
  // 0.2.2 — tier (b) FIRST: built-in envelopes from `<hostRoot>/plugins/*` register
  // before node_modules and before the workspace registry, so core code claims its
  // types before anything external could shadow them.
  const discoveredEnvelopes = discoverBuiltinEnvelopes();
  const envelopeLoad = await loadBuiltinEnvelopes(pluginRegistry);
  // Serve an envelope's FRONTEND only if its backend actually registered — see
  // `servableEnvelopes` for why absent beats broken here.
  const envelopes = servableEnvelopes(discoveredEnvelopes, envelopeLoad.records);
  for (const e of discoveredEnvelopes) {
    if (envelopes.includes(e)) continue;
    console.warn(
      `[plugin-host] envelope '${e.name}' did not load — its frontend bundle will NOT be served`,
    );
  }
  // 2.1.58 (M33 `m33l2001` step 1 (iii), M31 `vzkw903j`): the package list is
  // the workspace VIEW's (`workspace.json` in a workspace with a home), and every
  // listed package resolves in ONE directory — `node_modules` of the workspace's
  // slots directory. One locator answers load, watch and frontend discovery; a
  // listed package missing there is skipped with PLUGIN_NOT_INSTALLED and the
  // start goes on. The server never installs a package.
  const basePackages = resolvePluginPackages(workspace);
  const baseLocator = basePackageLocator(
    workspaceNodeModulesDir(registry.slotsDir(workspace)),
    PREDEFINED_PLUGINS,
  );
  const pluginLoad = await loadWorkspacePlugins(pluginRegistry, basePackages, undefined, baseLocator);
  pluginLoad.records.unshift(...envelopeLoad.records);
  // 2.1.41 (M13) — ref placement / unknown-target warnings, once the whole base
  // pool has registered (a plugin may load before the envelope it points at).
  logRefRegistrationWarnings(refRegistrationWarnings(pluginRegistry.listAvailable()));

  const httpServer = createHttpServer(app);
  // Membership is re-read per upgrade (`getProject` re-resolves the workspace
  // from the registry file), so a project added while the process runs becomes
  // connectable without a restart — the same freshness the HTTP prefix
  // middleware already has.
  //
  // This THROWS on a registry it cannot read (invalid JSON, an unreadable
  // `~/.claude4spec`, a `$schemaVersion` from a newer build). The gateway
  // catches that and fails closed — see `WsGateway.isMember` for why the guard
  // belongs there and not here.
  const gateway = new WsGateway(
    httpServer,
    (id) => registry.getProject(workspace, id) !== null,
    (req) => checkRequest(req, liveWorkspace(), { checkOrigin: true }),
  );

  // M40: ONE file-watch runtime per PROCESS, not per ProjectContext. It has to
  // outlive context rebuilds for two reasons a context-owned watcher could never
  // solve: `plugins:base` observes a pool shared by every project (there is no
  // context it could belong to), and `plugins:overlay` observes a source whose
  // event DESTROYS its own container (reloading the pool rebuilds the
  // ProjectContext). A dispatched handler finishes inside this process-wide
  // instance even if the rebuild drops its subscription meanwhile.
  //
  // M40 owns the WS transport but never the event catalog: it routes by the
  // mount's scope, and each owner constructs the event it declares.
  // 2.1.22: a `process`-scope event reaches EVERY room of the gateway (each
  // project separately), a `context:<id>` one only that project's room — see
  // `createRoomBroadcaster`.
  const watchRuntime = new FileWatchRuntime({
    broadcaster: createRoomBroadcaster(gateway),
  });

  // M33 phase 3 / 0.2.2: the base frontend tier — workspace/npm packages (the
  // same resolved list `loadWorkspacePlugins` consumed) and the servable
  // envelopes — served ungated for every project: by the process-global asset
  // route, and announced by every project's manifest (2.1.22). ONE object for
  // both: the asset route below and every project context get the same tier,
  // workspace-root resolver included, so what a manifest announces is what the
  // route serves (L11 `9g96q3pp`).
  const frontendBase: FrontendBaseTier = {
    workspacePackages: basePackages,
    envelopes,
    resolveWorkspaceRoot: baseLocator.packageRoot,
  };

  // M31 `m31ctx001` / M01 `dsh8ezbz`: lazily-built, cached per-project
  // contexts. Every project — none is an exception — is activated and built on
  // its FIRST REQUEST, never before listen: the activation (refusal of a
  // workspace home, the config from the file and the defaults, the fresh file,
  // the roots, the welcome page, the legacy db move) runs inside the build, so
  // its failure is that project's `500 PROJECT_BUILD_FAILED` and the process
  // keeps serving. No start flag reaches a project except `--remote-url`, for
  // every project alike. `activated` is the process's record of activated
  // projects, shared with the registration route below: a project added through
  // POST /api/workspace/projects is not activated a second time by its first build.
  const activated = new ActivatedProjects();
  const cache: ProjectContextCache = new ProjectContextCache(activatingBuild(registry, workspace, (project) =>
    buildProjectContext({
      registry,
      pluginRegistry,
      pluginRecords: pluginLoad.records,
      frontendBase,
      workspace,
      projectId: project.id,
      cwd: project.cwd,
      gateway,
      watchRuntime,
      mode,
      remoteApiUrl: opts.remoteApiUrl,
      onTurnFinished: () => cache.reapIdle(),
      onContextConfigChanged: (opts) => cache.invalidate(project.id, opts),
      // 2.1.9 (M52 `1v62dbhb`): a provider's context, on request, from this cache
      // — the `project-exposed` source of a consumer holds no handle of its own.
      providerContext: async (providerId) => {
        const record = registry.getWorkspace(workspace.name)?.projects.find((p) => p.id === providerId);
        if (!record) throw new Error(`project "${providerId}" is not in workspace "${workspace.name}"`);
        return cache.get(record);
      },
    }),
  activated));

  // M33 phase 3: process-global base (workspace/npm) plugin hot-reload watcher.
  // The base catalog is shared across projects, so a reload mutates the shared
  // `pluginRegistry` (unregister old → register new) and invalidates ALL cached
  // contexts; each live project room is told to remount.
  //
  // M33 L7 `m33l7wch` (2.1.58): discovery uses the base locator — the SAME ESM
  // resolution, counted from the SAME workspace `node_modules`, as the file the
  // bootstrap imported (the loader imports exactly `resolveEntry(pkg)`), never
  // CJS `createRequire(...).resolve`. So an ESM-only package (only an `import`
  // condition in `exports`) that loads at bootstrap is ALSO watched here — load
  // and watch can't drift. `dirname` of the resolved entry is the dist dir; a
  // package not installed resolves to null and is simply not watched.
  // ASSUMPTION:dev-0302 — only the packages resolved at start are watched; one
  // installed (or listed) later takes effect from the next start.
  const baseDirByPkg = new Map<string, string>();
  for (const pkg of basePackages) {
    const entry = baseLocator.resolveEntry(pkg);
    if (entry) baseDirByPkg.set(pkg, path.dirname(entry));
  }
  // Serialize reload runs so overlapping flushes never interleave
  // unregister/register on the shared registry.
  let baseReloadChain: Promise<void> = Promise.resolve();
  // M33: the base pool is the one `scope: 'process'` mount in the system — it
  // survives every ProjectContext rebuild, because it belongs to no project.
  for (const dir of new Set(baseDirByPkg.values())) {
    watchRuntime.mountSource({ source: `${PLUGINS_BASE_SOURCE}:${dir}`, dir, scope: 'process' });
  }
  // The runtime debounces PER FILE, but a plugin rebuild rewrites a whole dist/
  // at once — without a burst-level coalesce that is one reloadPlugin() and one
  // cache.invalidateAll() per file (~30 full context rebuilds for one `npm run
  // build`, and 30 `plugin:reloaded` events at the client). The watcher this
  // replaced coalesced a burst into a single reload; keep that invariant here.
  const BURST_MS = 300;
  const burstTimers = new Map<string, NodeJS.Timeout>();
  const scheduleBaseChange = (dir: string): void => {
    const prev = burstTimers.get(dir);
    if (prev) clearTimeout(prev);
    burstTimers.set(
      dir,
      setTimeout(() => {
        burstTimers.delete(dir);
        onBaseChange(dir);
      }, BURST_MS),
    );
  };
  const onBaseChange = (dir: string): void => {
    const affected = [...baseDirByPkg.entries()].filter(([, d]) => d === dir).map(([pkg]) => pkg);
    if (affected.length === 0) return;
    baseReloadChain = baseReloadChain
      .then(async () => {
        const reloaded = [];
        for (const pkg of affected) {
          const rec = await reloadPlugin(pluginRegistry, pkg, { resolveEntry: baseLocator.resolveEntry });
          // 2.1.20: keep the base records current — the frontend manifest
          // announces only packages whose backend is `loaded`. A failed reload
          // retains the old version, so only a `loaded` outcome replaces it.
          if (rec.status === 'loaded') {
            const i = pluginLoad.records.findIndex((r) => r.package === pkg);
            if (i >= 0) pluginLoad.records[i] = { ...pluginLoad.records[i], ...rec };
            else pluginLoad.records.push(rec);
          }
          reloaded.push({ name: rec.manifestName ?? pkg, version: rec.manifestVersion ?? '' });
        }
        // Invalidate once (not per-package), then broadcast. 2.1.22 (M33/L7
        // `m33l7pln` step 5, M40 `kc23agex`): `plugins:base` is a
        // `scope: 'process'` mount, so its event goes through the M40 runtime
        // to the room of EVERY project of the process — the gateway's rooms,
        // not the context cache, which invalidateAll() has just emptied.
        cache.invalidateAll();
        for (const r of reloaded) {
          watchRuntime.broadcast('process', { kind: 'plugin:reloaded', name: r.name, version: r.version, tier: 'base' });
        }
      })
      .catch((err) => console.warn('[plugin-loader] base reload failed:', err));
  };
  for (const dir of new Set(baseDirByPkg.values())) {
    watchRuntime.subscribe(
      `${PLUGINS_BASE_SOURCE}:${dir}`,
      { onChange: () => scheduleBaseChange(dir), onUnlink: () => scheduleBaseChange(dir) },
      { id: 'm33-base-reload', phase: 'reload', scope: 'process' },
    );
  }

  // Registration with activation — POST /api/workspace/projects (M01 file steps,
  // then the registration and the legacy db move); the context itself is built
  // on the project's first request, like every other.
  // 0.2.93: no integration artifact is written here — the MCP config is served
  // on demand by `GET /api/projects/:id/_meta/mcp-config`.
  const activateProject = async (projectCwd: string) => {
    return bootstrapProject(registry, workspace, projectCwd, activated).project;
  };

  app.use('/api', workspaceRouter({ registry, workspace, cache, mode, activateProject }));
  // M33: process-level plugin endpoints (runtime shims, BASE-tier frontend
  // assets, loader diagnostics) — before the project dispatch so they stay
  // prefix-free. 2.1.22: the frontend manifest and the overlay assets are the
  // project router's (`/api/projects/:id/plugins/…`, see `buildProjectContext`);
  // nothing here is bound to the project the process started with.
  app.use(
    '/api',
    pluginsRouter({ pluginRegistry, pluginRecords: pluginLoad.records, ...frontendBase }),
  );
  app.use('/api/projects/:id', projectDispatchMiddleware(registry, workspace, cache));
  // M49: the envelope is the layer's, not the module's. Anything a route under
  // `/api` passes to `next(err)` without an error handler of its own — the
  // workspace and plugin routers, a body that failed to parse — leaves as
  // `{ error: { code, message } }` instead of Express's HTML error page.
  app.use('/api', errorHandler);

  // 2.1.58 (M31 `m31ctx001`): no project is built before listen — fail-fast of
  // a broken project config at process start is given up deliberately.

  const spaDeps = { registry, workspace, startCwd: cwd };
  const closeAssets = mode === 'dev' ? await mountDevVite(app, spaDeps) : mountProd(app, spaDeps);

  const host = opts.host ?? effectiveBindHost(liveWorkspace());
  const port = await listenOrExit(httpServer, portRef.current, host);
  portRef.current = port;
  // The LOCAL address (loopback, or a concrete bindHost) — what the launcher
  // opens in the browser. Never `publicUrl`.
  const url = localServerUrl({ defaultPort: port, bindHost: host });

  return {
    url,
    port,
    shutdown: async () => {
      /**
       * FIRST, before the watcher can hand out another event to reschedule one.
       *
       * These are the one set of timers in the system with no owner: the base
       * pool is the only `scope: 'process'` mount, so `disposeScope` never sees
       * it and the sole `clearTimeout` above is the RESCHEDULE path. A burst
       * timer pending at shutdown therefore held the event loop open for its
       * remaining window and then fired `onBaseChange` — `reloadPlugin`,
       * `cache.invalidateAll()`, `gateway.broadcast` — against contexts that
       * had just been disposed underneath it.
       */
      for (const timer of burstTimers.values()) clearTimeout(timer);
      burstTimers.clear();
      // Cancelling the pending timers only closes half of it. A burst that
      // ALREADY fired has queued its reload on `baseReloadChain` —
      // `reloadPlugin` → `cache.invalidateAll()` → `gateway.broadcast` — and
      // that work is not a timer, so nothing above stops it. Draining the chain
      // here is what actually establishes "no base reload runs after this
      // point"; without it the sequence described above still happens, just
      // from the queue instead of from a timer. A failed reload has already
      // been logged by the chain's own catch, so settling is enough.
      await baseReloadChain.catch(() => {});
      await watchRuntime.close();
      await cache.disposeAll();
      await gateway.close();
      await closeAssets();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

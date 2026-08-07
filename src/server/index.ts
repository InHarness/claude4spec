import express, { type Express } from 'express';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { WsGateway } from './ws/gateway.js';
import { FileWatchRuntime } from './fs/watcher.js';
import { PLUGINS_BASE_SOURCE } from './fs/sources.js';
import { WorkspaceRegistry } from './workspace/registry.js';
import { migrateLegacyDbIfNeeded } from './workspace/db-migration.js';
import { bootstrapProject } from './workspace/bootstrap.js';
import { ensureMcpJson, ensureMcpJsonForWorkspace } from './mcp/ensure-mcp-json.js';
import { buildProjectContext } from './workspace/project-context.js';
import { ProjectContextCache } from './workspace/context-cache.js';
import { projectDispatchMiddleware } from './workspace/middleware.js';
import { workspaceRouter } from './workspace/routes.js';
import type { WorkspaceRecord } from './workspace/types.js';
import { resolveSpaRoute } from './workspace/spa-route.js';
import { PluginRegistryImpl } from './core/plugin-host/registry.js';
import { registerAllPlugins } from './serialization/registerAll.js';
import {
  loadBuiltinEnvelopes,
  loadWorkspacePlugins,
  reloadPlugin,
  resolveBaseEntry,
} from './core/plugin-host/loader.js';
import { resolvePluginPackages } from './workspace/registry.js';
import { pluginsRouter } from './routes/plugins.js';
import { buildImportMap } from './core/plugin-host/runtime-shims.js';
import { discoverBuiltinEnvelopes, servableEnvelopes } from './core/plugin-host/builtin-envelopes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface StartOptions {
  cwd: string;
  /** M31: pre-selected workspace (CLI select-or-create). Absent ⇒ resolved here. */
  workspace?: WorkspaceRecord;
  /**
   * Decision #11 (0.1.57): register `cwd` as the initial project at start
   * (CLI `--create-project` / an implying flag). `false` ⇒ workspace-only
   * start — nothing is registered/activated, nothing is written to `cwd`, and
   * the bare command lands on `/welcome`. Defaults to `true` for back-compat
   * with callers that always meant "create".
   */
  createProject?: boolean;
  port?: number;
  mode?: 'dev' | 'prod';
  pagesDir?: string;
  name?: string;
  /** M27: bootstrap-time clone of this published remote project slug, before app.listen. */
  clone?: string;
  /**
   * M01 (0.1.36): resolved `--remote-url` value (flag > config.json). `null`/
   * absent ⇒ fall back to `bootConfig.remoteApiUrl`, then the M24 prod constant
   * (applied inside RemoteHttpClient). Drives both the M24 auth client and the
   * M27 clone-fetch base URL.
   */
  remoteApiUrl?: string | null;
  /** M27 (0.1.37): did THIS bootstrap run write config.json? Drives clone rollback. */
  configCreated?: boolean;
  /** M27 (0.1.37): did THIS bootstrap run create .claude4spec/? Drives clone rollback. */
  claudeDirCreated?: boolean;
  /** M27 (0.1.37): did THIS bootstrap run create .gitignore (vs append to a user's)? Drives clone rollback. */
  gitignoreCreated?: boolean;
}

export interface ServerHandle {
  url: string;
  port: number;
  writingStyle: { slug: string; title: string } | null;
  shutdown: () => Promise<void>;
}

const DEFAULT_PORT = 3000;

// M01: deterministyczny port. Przy zajetym porcie serwer NIE wskakuje juz na
// `port+1` — failuje z czytelnym bledem i niezerowym exit code. Powod: stały
// port workspace'u jest warunkiem discovery serwera przez `c4s ask`.
async function listenOrExit(server: HttpServer, port: number): Promise<number> {
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
      server.listen(port);
    });
    return port;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `port ${port} is in use — stop the other instance or change the workspace port / pass --port`,
      );
      process.exit(1);
    }
    throw err;
  }
}

// Wstrzykuje tozsamosc projektu do serwowanego HTML — zaraz po <head>, czyli PRZED
// inline theme-scriptem i bundlem React. Klient czyta `window.__C4S_PROJECT__.id`
// synchronicznie przy module-load, zeby suffiksowac project-scoped klucze localStorage
// (`::<scope>`), zbudowac API_BASE `/api/projects/<id>` i basepath routera `/p/<id>`.
// M31: id przychodzi z ROUTE (`/p/<id>/…` → registry lookup) i jest STABILNYM,
// przechowywanym `project.id` — nie przeliczamy go z cwd, zeby edycja cwd w
// workspaces.json nie rozjechala routera/basepath z URL-em.
function injectProjectGlobal(html: string, id: string, name: string): string {
  const payload = JSON.stringify({ id, name }).replace(/</g, '\\u003c');
  return html.replace('<head>', `<head><script>window.__C4S_PROJECT__=${payload};</script>`);
}

// M33 "Option B": inject the plugin import map into <head> statically (before any
// module script resolves), so a runtime plugin's bare imports (`react`, …) resolve
// to the host's singleton shims. Applied to every SPA page (welcome + project).
const IMPORT_MAP_SCRIPT = `<script type="importmap">${JSON.stringify({
  imports: buildImportMap(),
}).replace(/</g, '\\u003c')}</script>`;
function injectImportMap(html: string): string {
  return html.replace('<head>', `<head>${IMPORT_MAP_SCRIPT}`);
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
      // `/welcome` runs the SPA project-less: no `window.__C4S_PROJECT__`, so the
      // client computes PROJECT_ID='' → API_BASE='/api' → router basepath '/'.
      if (resolution.kind === 'welcome') {
        return res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      }
      const { project } = resolution;
      deps.registry.touchLastOpened(deps.workspace.name, project.id);
      html = injectProjectGlobal(html, project.id, project.name);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
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
      // `/welcome` runs the SPA project-less (no `window.__C4S_PROJECT__`).
      if (resolution.kind === 'welcome') {
        return res.status(200).set({ 'Content-Type': 'text/html' }).end(raw);
      }
      const { project } = resolution;
      deps.registry.touchLastOpened(deps.workspace.name, project.id);
      res
        .status(200)
        .set({ 'Content-Type': 'text/html' })
        .end(injectProjectGlobal(raw, project.id, project.name));
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

  const app = express();
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

  // M31: workspace registry — DB lives in the workspace slot, not the project dir.
  const registry = new WorkspaceRegistry();
  const workspace =
    opts.workspace ?? registry.selectOrCreate({ port: opts.port, mode: opts.mode });
  // Decision #11: a workspace-only start (`createProject === false`) registers
  // and activates nothing — `cwd` stays untouched and the bare command lands on
  // `/welcome`. Default `true` keeps the historic "always create" behavior.
  const createProject = opts.createProject ?? true;
  const initialProject = createProject ? registry.registerProject(workspace, cwd) : null;
  if (createProject && initialProject)
    migrateLegacyDbIfNeeded(registry, workspace, cwd, initialProject.id);

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
  const pluginLoad = await loadWorkspacePlugins(pluginRegistry, resolvePluginPackages(workspace));
  pluginLoad.records.unshift(...envelopeLoad.records);

  const httpServer = createHttpServer(app);
  const gateway = new WsGateway(httpServer);

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
  const watchRuntime = new FileWatchRuntime({
    broadcaster: {
      broadcast: (scope, event) => {
        if (scope === 'process') {
          for (const id of cache.liveProjectIds()) gateway.broadcast(id, event);
          return;
        }
        // Scope is `context:<projectId>#<instance>` — the instance suffix keeps
        // two live contexts for one project apart; the ROOM is still the project.
        gateway.broadcast(scope.slice('context:'.length).split('#')[0]!, event);
      },
    },
  });

  // M27 clone runs only on the FIRST build of the CLI-started project —
  // consumed here so a later cache rebuild never re-clones.
  let clonePending = opts.clone
    ? {
        slug: opts.clone,
        nameOverride: opts.name,
        configCreated: opts.configCreated ?? false,
        claudeDirCreated: opts.claudeDirCreated ?? false,
        gitignoreCreated: opts.gitignoreCreated ?? false,
      }
    : undefined;

  // M31: lazily-built, cached per-project contexts. The CLI-only overrides
  // (pagesDir flag, --remote-url, clone) apply solely to the initial project.
  const cache: ProjectContextCache = new ProjectContextCache(async (project) => {
    const isInitial = initialProject != null && project.id === initialProject.id;
    const clone = isInitial ? clonePending : undefined;
    if (clone) clonePending = undefined;
    return buildProjectContext({
      registry,
      pluginRegistry,
      pluginRecords: pluginLoad.records,
      workspace,
      projectId: project.id,
      cwd: project.cwd,
      gateway,
      watchRuntime,
      mode,
      remoteApiUrl: isInitial ? opts.remoteApiUrl : undefined,
      pagesDirOverride: isInitial ? opts.pagesDir : undefined,
      clone,
      onTurnFinished: () => cache.reapIdle(),
      onContextConfigChanged: () => cache.invalidate(project.id),
    });
  });

  // M33 phase 3: process-global base (workspace/npm) plugin hot-reload watcher.
  // The base catalog is shared across projects, so a reload mutates the shared
  // `pluginRegistry` (unregister old → register new) and invalidates ALL cached
  // contexts; each live project room is told to remount.
  //
  // M33 (0.1.92): discovery uses `resolveBaseEntry` — the SAME ESM resolution
  // (`import.meta.resolve`) as the bootstrap `import(pkg)`, not CJS
  // `createRequire(...).resolve`. So an ESM-only package (only an `import`
  // condition in `exports`) that loads at bootstrap is ALSO watched here — load
  // and watch can't drift. `dirname` of the resolved entry is the dist dir; an
  // unresolvable package (not installed) resolves to null and is simply not watched.
  const baseDirByPkg = new Map<string, string>();
  for (const pkg of resolvePluginPackages(workspace)) {
    const entry = resolveBaseEntry(pkg);
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
          const rec = await reloadPlugin(pluginRegistry, pkg);
          reloaded.push({ name: rec.manifestName ?? pkg, version: rec.manifestVersion ?? '' });
        }
        // Snapshot the rooms BEFORE invalidating: invalidateAll() empties the
        // cache, after which liveProjectIds() would return [] and no client
        // would ever be told to remount. Then invalidate once (not per-package).
        const rooms = cache.liveProjectIds();
        cache.invalidateAll();
        for (const id of rooms) {
          for (const r of reloaded) {
            gateway.broadcast(id, { kind: 'plugin:reloaded', name: r.name, version: r.version, tier: 'base' });
          }
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

  // Per-project activation — POST /api/workspace/projects runs the SAME full
  // bootstrap as a CLI start (M01/M12/M22 hooks + registration + db migration).
  const activateProject = async (projectCwd: string) => {
    const project = bootstrapProject(registry, workspace, projectCwd).project;
    /**
     * 0.2.13: the project added at RUNTIME needs its `mcp.json` too.
     *
     * `bootstrapProject` stopped writing it (it could only ever write
     * `workspace.defaultPort`, which is wrong for a server started on any other
     * port), and its replacement runs once after `listen` over the project list
     * as it stood then. That left exactly this path uncovered: a project added
     * through the workspace UI got no `mcp.json` at all, so the editor showed no
     * `c4s-spec-reader` server and the spec-reader skill had no MCP surface —
     * until the user happened to restart.
     *
     * `portRef.current` rather than the requested port: by the time a project
     * can be added the server has bound, and `listenOrExit` may have moved.
     */
    try {
      ensureMcpJson({ projectAbsPath: project.cwd, port: portRef.current, projectId: project.id });
    } catch {
      /* a read-only project directory must not fail activation */
    }
    return project;
  };

  app.use('/api', workspaceRouter({ registry, workspace, cache, mode, activateProject }));
  // M33: process-level plugin endpoints (frontend manifest, runtime shims,
  // loader diagnostics) — before the project dispatch so they stay prefix-free.
  // Phase 2: project-local frontend serving binds to the process's primary
  // project (the `--cwd`); `isTrusted` is read live so a trust flip applies
  // without a restart. Workspace-only starts register nothing ⇒ serving disabled.
  app.use(
    '/api',
    pluginsRouter({
      pluginRegistry,
      pluginRecords: pluginLoad.records,
      frontendServing: initialProject
        ? { cwd, isTrusted: () => registry.getProjectTrust(workspace, initialProject.id) === true }
        : undefined,
      // M33 phase 3: workspace/npm plugin frontends are served ungated for every
      // project — the same resolved package list `loadWorkspacePlugins` consumed.
      workspacePackages: resolvePluginPackages(workspace),
      // 0.2.2: envelope frontends are served ungated too — an envelope lives in
      // the host repo, so the discovered list is its own allowlist.
      envelopes,
    }),
  );
  app.use('/api/projects/:id', projectDispatchMiddleware(registry, workspace, cache));

  // Eager warm of the CLI-started project: clone executes before listen and a
  // broken initial config still fails the boot fast (parity with pre-M31). A
  // workspace-only start has no initial project to warm.
  const initialCtx = initialProject ? await cache.get(initialProject) : null;

  const spaDeps = { registry, workspace, startCwd: cwd };
  const closeAssets = mode === 'dev' ? await mountDevVite(app, spaDeps) : mountProd(app, spaDeps);

  const port = await listenOrExit(httpServer, portRef.current);
  portRef.current = port;
  /**
   * 0.2.13: refresh every project's `.claude4spec/mcp.json` with the port we
   * actually bound. Here, not in `bootstrapProject` — see the note on
   * `ensureMcpJsonForWorkspace`. This is also the upgrade path that replaces the
   * pre-0.2.13 stdio entries the rewritten `c4s-mcp` can no longer start.
   */
  const liveWorkspace = registry.getWorkspace(workspace.name) ?? workspace;
  ensureMcpJsonForWorkspace(liveWorkspace.projects, port, liveWorkspace.defaultPort);
  if (initialProject) registry.touchLastOpened(workspace.name, initialProject.id);
  const url = `http://localhost:${port}`;

  return {
    url,
    port,
    writingStyle: initialCtx?.writingStyle ?? null,
    shutdown: async () => {
      await watchRuntime.close();
      await cache.disposeAll();
      await gateway.close();
      await closeAssets();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

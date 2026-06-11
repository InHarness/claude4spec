import express, { type Express } from 'express';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { WsGateway } from './ws/gateway.js';
import { WorkspaceRegistry } from './workspace/registry.js';
import { migrateLegacyDbIfNeeded } from './workspace/db-migration.js';
import { bootstrapProject } from './workspace/bootstrap.js';
import { buildProjectContext } from './workspace/project-context.js';
import { ProjectContextCache } from './workspace/context-cache.js';
import { projectDispatchMiddleware } from './workspace/middleware.js';
import { workspaceRouter } from './workspace/routes.js';
import type { ProjectRecord, WorkspaceRecord } from './workspace/types.js';
import { PluginRegistryImpl } from './core/plugin-host/registry.js';
import { registerAllPlugins } from './serialization/registerAll.js';

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
// M31: cwd przychodzi z ROUTE (`/p/<id>/…` → registry lookup), nie z procesu.
function injectProjectGlobal(html: string, cwd: string, name: string): string {
  const id = createHash('sha1').update(cwd).digest('hex').slice(0, 12);
  const payload = JSON.stringify({ id, name }).replace(/</g, '\\u003c');
  return html.replace('<head>', `<head><script>window.__C4S_PROJECT__=${payload};</script>`);
}

const PROJECT_ROUTE_RE = /^\/p\/([0-9a-f]{12})(\/|$)/;

type SpaResolution =
  | { kind: 'project'; project: ProjectRecord }
  | { kind: 'redirect'; to: string }
  | { kind: 'welcome' };

/**
 * M31 route scheme `/p/<project-id>/…` (assets stay at root — no Vite
 * base changes). Decision #11 (0.1.57): `/` → 302 to the last-opened project
 * (else first registered, else `/welcome`); `/welcome` serves the SPA with NO
 * project injected (workspace-scope project list); unknown id and any other
 * non-asset path → redirect `/`.
 */
function resolveSpaRoute(
  registry: WorkspaceRegistry,
  workspace: WorkspaceRecord,
  urlPath: string,
): SpaResolution {
  const m = urlPath.match(PROJECT_ROUTE_RE);
  if (m) {
    const project = registry.getProject(workspace, m[1]!);
    return project ? { kind: 'project', project } : { kind: 'redirect', to: '/' };
  }
  if (urlPath === '/welcome') return { kind: 'welcome' };
  if (urlPath === '/' || urlPath === '') {
    const fresh = registry.getWorkspace(workspace.name) ?? workspace;
    if (fresh.projects.length === 0) return { kind: 'redirect', to: '/welcome' };
    const byRecency = [...fresh.projects].sort((a, b) =>
      (b.lastOpened ?? b.addedAt).localeCompare(a.lastOpened ?? a.addedAt),
    );
    return { kind: 'redirect', to: `/p/${byRecency[0]!.id}/` };
  }
  return { kind: 'redirect', to: '/' };
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
      // `/welcome` runs the SPA project-less: no `window.__C4S_PROJECT__`, so the
      // client computes PROJECT_ID='' → API_BASE='/api' → router basepath '/'.
      if (resolution.kind === 'welcome') {
        return res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      }
      const { project } = resolution;
      deps.registry.touchLastOpened(deps.workspace.name, project.id);
      html = injectProjectGlobal(html, project.cwd, project.name);
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
  // index:false — '/' must reach the catch-all (redirect to /p/<id>/), never a raw un-injected index.html.
  app.use(express.static(clientDist, { index: false }));
  app.use('*', (req, res, next) => {
    if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/ws')) return next();
    try {
      const urlPath = (req.originalUrl ?? '/').split('?')[0]!;
      const resolution = resolveSpaRoute(deps.registry, deps.workspace, urlPath);
      if (resolution.kind === 'redirect') return res.redirect(302, resolution.to);
      const raw = fs.readFileSync(path.join(clientDist, 'index.html'), 'utf-8');
      // `/welcome` runs the SPA project-less (no `window.__C4S_PROJECT__`).
      if (resolution.kind === 'welcome') {
        return res.status(200).set({ 'Content-Type': 'text/html' }).end(raw);
      }
      const { project } = resolution;
      deps.registry.touchLastOpened(deps.workspace.name, project.id);
      res
        .status(200)
        .set({ 'Content-Type': 'text/html' })
        .end(injectProjectGlobal(raw, project.cwd, project.name));
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

  // M31: workspace registry — DB lives in the workspace slot, not the project dir.
  const registry = new WorkspaceRegistry();
  const workspace =
    opts.workspace ?? registry.selectOrCreate({ port: opts.port, mode: opts.mode });
  // Decision #11: a workspace-only start (`createProject === false`) registers
  // and activates nothing — `cwd` stays untouched and the bare command lands on
  // `/welcome`. Default `true` keeps the historic "always create" behavior.
  const createProject = opts.createProject ?? true;
  const initialProject = createProject ? registry.registerProject(workspace, cwd) : null;
  if (createProject) migrateLegacyDbIfNeeded(registry, workspace, cwd);

  // M31: process-immutable plugin catalog, populated exactly once.
  const pluginRegistry = new PluginRegistryImpl();
  registerAllPlugins(pluginRegistry);

  const httpServer = createHttpServer(app);
  const gateway = new WsGateway(httpServer);

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
      workspace,
      cwd: project.cwd,
      gateway,
      mode,
      remoteApiUrl: isInitial ? opts.remoteApiUrl : undefined,
      pagesDirOverride: isInitial ? opts.pagesDir : undefined,
      clone,
      onTurnFinished: () => cache.reapIdle(),
      onContextConfigChanged: () => cache.invalidate(project.id),
    });
  });

  // Per-project activation — POST /api/workspace/projects runs the SAME full
  // bootstrap as a CLI start (M01/M12/M22 hooks + registration + db migration).
  const activateProject = async (projectCwd: string) => {
    return bootstrapProject(registry, workspace, projectCwd).project;
  };

  app.use('/api', workspaceRouter({ registry, workspace, cache, mode, activateProject }));
  app.use('/api/projects/:id', projectDispatchMiddleware(registry, workspace, cache));

  // Eager warm of the CLI-started project: clone executes before listen and a
  // broken initial config still fails the boot fast (parity with pre-M31). A
  // workspace-only start has no initial project to warm.
  const initialCtx = initialProject ? await cache.get(initialProject) : null;

  const spaDeps = { registry, workspace, startCwd: cwd };
  const closeAssets = mode === 'dev' ? await mountDevVite(app, spaDeps) : mountProd(app, spaDeps);

  const port = await listenOrExit(httpServer, portRef.current);
  portRef.current = port;
  if (initialProject) registry.touchLastOpened(workspace.name, initialProject.id);
  const url = `http://localhost:${port}`;

  return {
    url,
    port,
    writingStyle: initialCtx?.writingStyle ?? null,
    shutdown: async () => {
      await cache.disposeAll();
      await gateway.close();
      await closeAssets();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

import express, { type Express } from 'express';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { readConfig, writeConfig } from './config.js';
import { openDb, type Db } from './db/index.js';
import { PagesService } from './services/pages.js';
import { pagesRouter } from './routes/pages.js';
import { StaticHtmlService } from './services/static-html.js';
import { staticRouter } from './routes/static.js';
import { tagsRouter } from './routes/tags.js';
import { entitiesRouter } from './core/plugin-host/entities-router.js';
import { referencesRouter } from './routes/references.js';
import { TagsService, DomainError } from './services/tags.js';
import { VersionService } from './services/versions.js';
import { ReferencesService } from './services/references.js';
import { ChatService } from './services/chat.js';
import { SectionsService } from './services/sections.js';
import { registerExtensionReferenceType } from '../shared/reference-extensions.js';
import { PlanService } from './services/plan.js';
import { plansRouter } from './routes/plans.js';
import { BriefService } from './services/brief.js';
import { briefsRouter } from './routes/briefs.js';
import { PatchService } from './services/patch.js';
import { patchesRouter } from './routes/patches.js';
import { RemoteAuthService } from './services/remote-auth.js';
import { RemoteHttpClient, assertRemoteApiReachable } from './services/remote-http-client.js';
import { remoteAccountRouter } from './routes/remote-account.js';
import { remoteProjectRouter } from './routes/remote-project.js';
import { PagesFrontmatterIndexer } from './services/pages-frontmatter-indexer.js';
import { SectionIndexerService } from './services/section-indexer.js';
import { TodosIndexerService } from './services/todos-indexer.js';
import { PagesLinkIndexerService } from './services/pages-link-indexer.js';
import { PageSerializer } from './services/page-serializer.js';
import { PageVersionService } from './services/page-version.js';
import { RawEntityReader } from './domain/raw-entity-reader.js';
import { ReleaseService } from './services/release.js';
import { releasesRouter } from './routes/releases.js';
import { ReleasePushService } from './services/release-push.js';
import { releasePushesRouter } from './routes/release-pushes.js';
import { ReleaseImportService, rollbackClone } from './services/release-import.js';
import { C4S_VERSION } from './services/release-bundle.js';
import { createReleaseToolsServer } from './mcp/release-tools/index.js';
import { GitService } from './services/git.js';
import { gitRouter } from './routes/git.js';
import { WsGateway } from './ws/gateway.js';
import { PagesWatcher } from './fs/watcher.js';
import { EntitiesWatcher } from './fs/entities-watcher.js';
import { EntityStore } from './services/entity-store.js';
import { EntityIndexerService } from './services/entity-indexer.js';
import { createReferenceToolsServer } from './mcp/reference-tools.js';
import { SkillRegistry, SkillResolver, findSkillsRoots } from './services/skill-registry.js';
import { chatRouter } from './routes/chat.js';
import { threadsRouter } from './routes/threads.js';
import { sectionsRouter } from './routes/sections.js';
import { todosRouter } from './routes/todos.js';
import { pageLinksRouter } from './routes/page-links.js';
import { errorHandler } from './routes/errors.js';
import { pluginHost } from './core/plugin-host/host.js';
import { pluginHostRouter } from './core/plugin-host/cross-cutting.js';
// Side-effect import: populates pluginHost via legacy adapter for the 4 entity types.
import './serialization/registerAll.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface StartOptions {
  cwd: string;
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

/**
 * M29: one-time best-effort backup of the derived SQLite before a DB→text
 * export / divergent-rebuild, so the prior index is recoverable. Idempotent —
 * skips if the `.pre-migration.bak` already exists.
 */
function backupDbBeforeMigration(cwd: string): void {
  const src = path.join(cwd, '.claude4spec', 'db.sqlite');
  const bak = path.join(cwd, '.claude4spec', 'db.sqlite.pre-migration.bak');
  try {
    if (fs.existsSync(src) && !fs.existsSync(bak)) fs.copyFileSync(src, bak);
  } catch (err) {
    console.warn('[m29] db backup failed:', (err as Error).message);
  }
}

// M01: deterministyczny port. Przy zajetym porcie serwer NIE wskakuje juz na
// `port+1` — failuje z czytelnym bledem i niezerowym exit code. Powod: stały
// `config.json.port` jest warunkiem discovery serwera przez `c4s ask`.
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
        `port ${port} is in use — stop the other instance or change the port in config.json / pass --port`,
      );
      process.exit(1);
    }
    throw err;
  }
}

// Wstrzykuje tozsamosc projektu do serwowanego HTML — zaraz po <head>, czyli PRZED
// inline theme-scriptem i bundlem React. Klient czyta `window.__C4S_PROJECT__.id`
// synchronicznie przy module-load, zeby suffiksowac project-scoped klucze localStorage
// (`::<scope>`). Scope = sha1(cwd) jest niezalezny od portu — kolizja brala sie z reuzycia
// tego samego host:port dla roznych katalogow. Zobacz brief 0.1.40→0.1.41 (c4sproj01).
function injectProjectGlobal(html: string, cwd: string): string {
  const id = createHash('sha1').update(cwd).digest('hex').slice(0, 12);
  const payload = JSON.stringify({ id, name: path.basename(cwd) }).replace(/</g, '\\u003c');
  return html.replace('<head>', `<head><script>window.__C4S_PROJECT__=${payload};</script>`);
}

async function mountDevVite(app: Express, cwd: string) {
  const { createServer } = await import('vite');
  const repoRoot = findRepoRoot(cwd);
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
      const htmlPath = path.join(repoRoot, 'src/client/index.html');
      let html = await fs.promises.readFile(htmlPath, 'utf-8');
      html = await vite.transformIndexHtml(req.originalUrl, html);
      html = injectProjectGlobal(html, cwd);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (err) {
      vite.ssrFixStacktrace(err as Error);
      next(err);
    }
  });
  return async () => { await vite.close(); };
}

function mountProd(app: Express, cwd: string) {
  const repoRoot = findRepoRoot(cwd);
  const clientDist = path.join(repoRoot, 'dist/client');
  app.use(express.static(clientDist));
  app.use('*', (req, res, next) => {
    if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/ws')) return next();
    try {
      const raw = fs.readFileSync(path.join(clientDist, 'index.html'), 'utf-8');
      res.status(200).set({ 'Content-Type': 'text/html' }).end(injectProjectGlobal(raw, cwd));
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
  // M26 §3: runtime-only ISO timestamp captured at boot; surfaced in
  // GET /api/config so the client can detect "Restart required" by comparing
  // it to `localStorage['c4s:settings:last-restart-patch-at']`. Not persisted.
  const serverStartedAt = new Date().toISOString();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const skillRegistry = SkillRegistry.load(findSkillsRoots(cwd));
  const bootConfig = readConfig(cwd);
  // Effective pagesDir precedence: CLI flag > config.json > hardcoded 'pages'.
  const pagesDir = opts.pagesDir ?? bootConfig.pagesDir ?? 'pages';
  // M21: briefsDir, default '.claude4spec/briefs'. Walidacja: musi byc relative,
  // nie moze uciekac z cwd. Kolizja z pagesDir → tylko warn (user moze mocno
  // celowo umieszczac brief'y w katalogu pages — frontmatter.type='brief'
  // pelni hidden-tree filter).
  const briefsDir = bootConfig.briefsDir ?? '.claude4spec/briefs';
  if (path.isAbsolute(briefsDir)) {
    throw new Error(`config.json: briefsDir must be relative to cwd, got: ${briefsDir}`);
  }
  const briefsAbs = path.resolve(cwd, briefsDir);
  const briefsRel = path.relative(cwd, briefsAbs);
  if (briefsRel.startsWith('..') || path.isAbsolute(briefsRel)) {
    throw new Error(`config.json: briefsDir must not escape project root, got: ${briefsDir}`);
  }
  if (briefsDir === pagesDir) {
    console.warn(
      `[config] briefsDir === pagesDir ("${pagesDir}") — brief files will be visible in both indexers`,
    );
  }
  // M23: patchesDir, default '.claude4spec/patches'. Same validation as briefsDir.
  const patchesDir = bootConfig.patchesDir ?? '.claude4spec/patches';
  if (path.isAbsolute(patchesDir)) {
    throw new Error(`config.json: patchesDir must be relative to cwd, got: ${patchesDir}`);
  }
  const patchesAbs = path.resolve(cwd, patchesDir);
  const patchesRel = path.relative(cwd, patchesAbs);
  if (patchesRel.startsWith('..') || path.isAbsolute(patchesRel)) {
    throw new Error(`config.json: patchesDir must not escape project root, got: ${patchesDir}`);
  }
  if (patchesDir === pagesDir || patchesDir === briefsDir) {
    console.warn(
      `[config] patchesDir collides with pagesDir/briefsDir ("${patchesDir}") — patch files will be visible in multiple indexers`,
    );
  }

  // M29: entitiesDir, default '.claude4spec/entities'. Same path-safety as
  // briefsDir/patchesDir — but this directory is COMMITTED to git (source of
  // truth for entities; SQLite is a derived index rebuilt from it at boot).
  const entitiesDir = bootConfig.entitiesDir ?? '.claude4spec/entities';
  if (path.isAbsolute(entitiesDir)) {
    throw new Error(`config.json: entitiesDir must be relative to cwd, got: ${entitiesDir}`);
  }
  const entitiesAbs = path.resolve(cwd, entitiesDir);
  const entitiesRel = path.relative(cwd, entitiesAbs);
  if (entitiesRel.startsWith('..') || path.isAbsolute(entitiesRel)) {
    throw new Error(`config.json: entitiesDir must not escape project root, got: ${entitiesDir}`);
  }
  // M01 (0.1.36): resolve the remote base URL with precedence
  // `--remote-url` flag (opts) > config.json > prod constant. The prod-constant
  // fallback lives in RemoteHttpClient; here `null` means "use prod".
  const remoteApiUrl = opts.remoteApiUrl ?? bootConfig.remoteApiUrl;
  // M24: an explicit remoteApiUrl override (flag or config.json) must be a valid,
  // reachable host — hard error at boot, no fallback to the production constant.
  if (remoteApiUrl != null && remoteApiUrl.trim() !== '') {
    await assertRemoteApiReachable(remoteApiUrl);
  }
  pluginHost.consolidate(bootConfig.entities);
  const hostState = pluginHost.state();
  console.log(
    `[plugin-host] active: [${hostState.active.join(', ') || '∅'}]` +
      (hostState.inactive.length ? `, inactive: [${hostState.inactive.join(', ')}]` : '') +
      (hostState.unknown.length ? `, unknown: [${hostState.unknown.join(', ')}]` : ''),
  );
  const initialWritingStyle = bootConfig.writingStyle;
  if (initialWritingStyle !== null && !skillRegistry.isSelectable(initialWritingStyle)) {
    const available = skillRegistry.listSelectable().map((s) => s.slug).join(', ') || '(none)';
    throw new Error(
      `config.json: writingStyle "${initialWritingStyle}" not a selectable writing-style skill. Available: ${available}`,
    );
  }
  const skillResolver = new SkillResolver(skillRegistry, cwd);

  const db: Db = openDb(cwd);
  const pages = new PagesService(cwd, pagesDir);
  await pages.ensureRoot();
  // M30: static file server rooted at the same pagesDir, backing the HTML preview iframe.
  const staticHtml = new StaticHtmlService(cwd, pagesDir);
  // M21 m02multidir: drugi PagesService dla briefsDir. Wspoldziel z pierwszym
  // zarowno PageVersionService jak i WsGateway, ale ma osobny watcher (debounce
  // independent per katalog) i osobny PageSerializer (constructor-bound do
  // odpowiedniego rootDir).
  const briefsPages = new PagesService(cwd, briefsDir);
  await briefsPages.ensureRoot();
  // M23 m02multidir: trzeci PagesService dla patchesDir (analogicznie do briefsDir).
  const patchesPages = new PagesService(cwd, patchesDir);
  await patchesPages.ensureRoot();

  const tagsService = new TagsService(db.handle);
  const versionService = new VersionService(db.handle);
  const rawReader = new RawEntityReader(db.handle);
  // M17: wire snapshot capture deps. After this, every entity service
  // mutation captures a deterministic snapshot via host.snapshot(...).
  versionService.configureSnapshot(rawReader, pluginHost);
  // M24: remote-account identity (device flow + local session). Single HTTP
  // client per process; base URL from config.remoteApiUrl (or the prod constant).
  const remoteHttpClient = new RemoteHttpClient(remoteApiUrl);
  const remoteAuthService = new RemoteAuthService(db.handle, remoteHttpClient);
  const chatService = new ChatService(db.handle);
  // Orphan cleanup: rowsy chat_message.status='streaming' pozostale po crashu poprzedniego
  // procesu (SIGKILL/OOM) — brak aktywnego adaptera po starcie, flipujemy wszystkie na 'complete'.
  chatService.finalizeAllStreamingRows();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode, cwd });
  });

  app.get('/api/meta', (_req, res) => {
    res.json({ cwd, cwdName: path.basename(cwd), c4sVersion: C4S_VERSION });
  });

  app.get('/api/config', (_req, res) => {
    // readConfig per-request: PATCH /api/config musi byc widoczny w GET bez restartu.
    // Spojne z istniejacym wzorcem SkillResolver (per-query disk read).
    const c = readConfig(cwd);
    res.json({
      name: c.name,
      port: portRef.current,
      pagesDir: c.pagesDir,
      mode,
      writingStyle: c.writingStyle,
      onboarding: { completed: c.onboardingCompleted },
      briefsDir: c.briefsDir,
      patchesDir: c.patchesDir,
      entities: c.entities,
      agent: { claudeUsePreset: c.agent?.claudeUsePreset ?? true },
      git: {
        syncCommitOnRelease: c.git?.syncCommitOnRelease ?? false,
        syncPushOnPush: c.git?.syncPushOnPush ?? false,
      },
      remoteProjectId: c.remoteProjectId ?? null,
      remoteApiUrl: c.remoteApiUrl ?? null,
      $schemaVersion: c.$schemaVersion,
      serverStartedAt,
    });
  });

  app.patch('/api/config', (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // M26 §2: hot-reload (name, writingStyle, agent.claudeUsePreset) and
      // restart-required (port, mode, pagesDir, briefsDir, patchesDir, entities)
      // share one atomic disk write. `writeConfig` re-runs the full validation in
      // `config.ts`; this handler only enforces semantic checks the validator
      // cannot do (writingStyle selectability, name regex, path safety).
      const patch: Partial<{
        name: string;
        port: number;
        pagesDir: string;
        briefsDir: string;
        patchesDir: string;
        mode: 'dev' | 'prod';
        writingStyle: string | null;
        onboardingCompleted: boolean;
        entities: string[];
        agent: { claudeUsePreset?: boolean };
        git: { syncCommitOnRelease?: boolean; syncPushOnPush?: boolean };
        remoteProjectId: string | null;
      }> = {};

      if ('name' in body) {
        if (typeof body.name !== 'string') {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'name must be a string' } });
        }
        const trimmed = body.name.trim();
        if (trimmed.length < 1 || trimmed.length > 80 || !/^[a-zA-Z0-9._\- ]+$/.test(trimmed)) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'name: 1-80 chars, allowed [a-zA-Z0-9._- ]' } });
        }
        patch.name = trimmed;
      }

      if ('port' in body) {
        if (typeof body.port !== 'number' || !Number.isInteger(body.port) || body.port < 1 || body.port > 65535) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'port must be an integer in [1, 65535]' } });
        }
        patch.port = body.port;
      }

      if ('mode' in body) {
        if (body.mode !== 'dev' && body.mode !== 'prod') {
          return res.status(400).json({ error: { code: 'VALIDATION', message: "mode must be 'dev' | 'prod'" } });
        }
        patch.mode = body.mode;
      }

      // pagesDir/briefsDir/patchesDir share the same path-safety contract as boot:
      // must be relative, must not escape cwd. Reuse the local helper inline to
      // keep validation co-located with the patch handler.
      const validateDir = (field: string, value: unknown): string | { error: string } => {
        if (typeof value !== 'string' || value.trim() === '') {
          return { error: `${field} must be a non-empty string` };
        }
        if (path.isAbsolute(value)) {
          return { error: `${field} must be relative to cwd` };
        }
        const abs = path.resolve(cwd, value);
        const rel = path.relative(cwd, abs);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          return { error: `${field} must not escape project root` };
        }
        return value;
      };

      for (const field of ['pagesDir', 'briefsDir', 'patchesDir'] as const) {
        if (field in body) {
          const result = validateDir(field, body[field]);
          if (typeof result === 'object') {
            return res.status(400).json({ error: { code: 'VALIDATION', message: result.error } });
          }
          patch[field] = result;
        }
      }

      if ('writingStyle' in body) {
        if (body.writingStyle !== null && typeof body.writingStyle !== 'string') {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'writingStyle must be string | null' } });
        }
        if (typeof body.writingStyle === 'string' && !skillRegistry.isSelectable(body.writingStyle)) {
          const available = skillRegistry.listSelectable().map((s) => s.slug).join(', ') || '(none)';
          return res.status(400).json({ error: { code: 'VALIDATION', message: `writingStyle "${body.writingStyle}" not a selectable writing-style skill. Available: ${available}` } });
        }
        patch.writingStyle = body.writingStyle;
      }

      if ('onboardingCompleted' in body) {
        if (typeof body.onboardingCompleted !== 'boolean') {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'onboardingCompleted must be boolean' } });
        }
        patch.onboardingCompleted = body.onboardingCompleted;
      }

      if ('entities' in body) {
        if (!Array.isArray(body.entities) || !body.entities.every((e) => typeof e === 'string')) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'entities must be string[]' } });
        }
        patch.entities = body.entities as string[];
      }

      if ('agent' in body) {
        const a = body.agent;
        if (a === null || typeof a !== 'object' || Array.isArray(a)) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'agent must be an object' } });
        }
        const ar = a as Record<string, unknown>;
        const next: { claudeUsePreset?: boolean } = {};
        if ('claudeUsePreset' in ar) {
          if (typeof ar.claudeUsePreset !== 'boolean') {
            return res.status(400).json({ error: { code: 'VALIDATION', message: 'agent.claudeUsePreset must be boolean' } });
          }
          next.claudeUsePreset = ar.claudeUsePreset;
        }
        patch.agent = next;
      }

      // M28: hot-reload git-sync toggles. Only present subfields are forwarded;
      // writeConfig deep-merges `git` so the untouched toggle is preserved.
      if ('git' in body) {
        const g = body.git;
        if (g === null || typeof g !== 'object' || Array.isArray(g)) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'git must be an object' } });
        }
        const gr = g as Record<string, unknown>;
        const next: { syncCommitOnRelease?: boolean; syncPushOnPush?: boolean } = {};
        if ('syncCommitOnRelease' in gr) {
          if (typeof gr.syncCommitOnRelease !== 'boolean') {
            return res.status(400).json({ error: { code: 'VALIDATION', message: 'git.syncCommitOnRelease must be boolean' } });
          }
          next.syncCommitOnRelease = gr.syncCommitOnRelease;
        }
        if ('syncPushOnPush' in gr) {
          if (typeof gr.syncPushOnPush !== 'boolean') {
            return res.status(400).json({ error: { code: 'VALIDATION', message: 'git.syncPushOnPush must be boolean' } });
          }
          next.syncPushOnPush = gr.syncPushOnPush;
        }
        patch.git = next;
      }

      // M25: allow manual clear/override of remoteProjectId (e.g. UI "clear" after
      // a stale UUID). null ⇒ next push is a first push again.
      if ('remoteProjectId' in body) {
        if (body.remoteProjectId !== null && typeof body.remoteProjectId !== 'string') {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'remoteProjectId must be string | null' } });
        }
        patch.remoteProjectId = body.remoteProjectId;
      }

      const updated = writeConfig(cwd, patch);
      res.json({
        name: updated.name,
        port: portRef.current,
        pagesDir: updated.pagesDir,
        mode,
        writingStyle: updated.writingStyle,
        onboarding: { completed: updated.onboardingCompleted },
        briefsDir: updated.briefsDir,
        patchesDir: updated.patchesDir,
        entities: updated.entities,
        agent: { claudeUsePreset: updated.agent?.claudeUsePreset ?? true },
        git: {
          syncCommitOnRelease: updated.git?.syncCommitOnRelease ?? false,
          syncPushOnPush: updated.git?.syncPushOnPush ?? false,
        },
        remoteProjectId: updated.remoteProjectId ?? null,
        remoteApiUrl: updated.remoteApiUrl ?? null,
        $schemaVersion: updated.$schemaVersion,
        serverStartedAt,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/writing-styles', (_req, res) => {
    const c = readConfig(cwd);
    res.json({
      active: c.writingStyle,
      available: skillRegistry.listSelectable().map((s) => ({
        slug: s.slug,
        title: s.title,
        description: s.description,
        version: s.version,
        language: s.language,
        source: s.source,
      })),
    });
  });

  const httpServer = createHttpServer(app);
  const gateway = new WsGateway(httpServer);
  const watcher = new PagesWatcher(pages.root, gateway);
  // M21 m02multidir: drugi PagesWatcher na briefsDir. Wspoldzieli ten sam
  // gateway (broadcast `page:changed` z drugiego katalogu — UI może slot-detect
  // przez prefix sciezki, jezeli kiedys bedzie potrzebne).
  const briefsWatcher = new PagesWatcher(briefsPages.root, gateway);
  // M23 m02multidir: trzeci PagesWatcher na patchesDir.
  const patchesWatcher = new PagesWatcher(patchesPages.root, gateway);
  // M29: dedicated watcher + file store + indexer for the committed entity store.
  // The page-family watchers above are rooted outside `.claude4spec/`, so this
  // watcher owns `<entitiesDir>` exclusively.
  const entitiesWatcher = new EntitiesWatcher(entitiesAbs);
  const entityStore = new EntityStore(cwd, entitiesDir, entitiesWatcher, rawReader, pluginHost);
  entityStore.ensureRoot();
  const entityIndexer = new EntityIndexerService(
    db.handle,
    entityStore,
    entitiesWatcher,
    gateway,
    pluginHost,
    tagsService,
    rawReader,
  );
  const referencesService = new ReferencesService(pages, watcher);
  const sectionsService = new SectionsService(db.handle);
  sectionsService.setWriteDeps({ pages, watcher });

  // M06 registers <section_ref/> as the 6th XML reference type via the
  // M19 extension reference types slot. Parser/serializer for the 5 core
  // types in xml-tags.ts is untouched; the slot lives in reference-extensions.ts.
  registerExtensionReferenceType({
    tag: 'section_ref',
    attrOrder: ['anchor'],
    validate: (attrs) => {
      const anchor = attrs.anchor ?? '';
      return anchor && sectionsService.has(anchor)
        ? { ok: true, category: 'ok' }
        : { ok: false, category: 'unknown-anchor' };
    },
  });
  const planService = new PlanService(db.handle, gateway, chatService);
  const sectionIndexer = new SectionIndexerService(db.handle, pages, watcher, gateway);
  const todosIndexer = new TodosIndexerService(pages, gateway);
  const pagesLinkIndexer = new PagesLinkIndexerService(pages, gateway);
  // M17: page versioning (out of L9 plugin host — decyzja 1)
  const pageSerializer = new PageSerializer(pages);
  // M21 m02multidir: osobny serializer dla briefsDir (PageSerializer trzyma
  // referencje do PagesService w konstruktorze — czyta z dysku przez nia).
  // PageVersionService akceptuje override serializera w recordVersion(),
  // wiec dwa serializery dziela jedna instancje wersjonowania.
  const briefsSerializer = new PageSerializer(briefsPages);
  // M23: serializer dla patchesDir (analogicznie do briefsSerializer).
  const patchesSerializer = new PageSerializer(patchesPages);
  const pageVersions = new PageVersionService(db.handle, pageSerializer);
  // M21 m02fmidx / M23: in-memory frontmatter indexer feeded przez trzy watchery.
  const pagesFrontmatterIndexer = new PagesFrontmatterIndexer(
    pages,
    briefsPages,
    patchesPages,
    gateway,
  );

  // Mount all active backend modules — each plugin constructs its own service,
  // mounts its router, registers its MCP server, and registers its entity
  // service via the supplied MountContext. Inactive plugins are skipped
  // (config.entities).
  pluginHost.mountBackend({
    app,
    db: db.handle,
    cwd,
    ws: gateway,
    tagsService,
    versionService,
    referencesService,
    entityStore,
    registerMcpServer: (name, server) => pluginHost.registerMcpServer(name, server),
    registerEntityService: (type, service) => pluginHost.registerEntityService(type, service),
  });

  // Cross-cutting MCP server — owned by the host, not a plugin (M13).
  // Registered as a factory: a fresh instance is built per agent turn so
  // concurrent turns never share one MCP transport.
  pluginHost.registerMcpServer('reference-tools', () =>
    createReferenceToolsServer({
      tagsService,
      referencesService,
      pagesService: pages,
      sectionsService,
      ws: gateway,
      db: db.handle,
      cwd,
      entityStore,
    }),
  );

  // M17: ReleaseService + cross-cutting `release-tools` MCP. Like
  // reference-tools, owned by the host (not a plugin) — release semantics
  // are dual-track (entities + pages), neither side is a plugin owner.
  const releaseService = new ReleaseService(
    db.handle,
    pluginHost,
    versionService,
    pageVersions,
    pageSerializer,
    rawReader,
    tagsService,
    pages,
    watcher,
    cwd,
  );
  // M29: release restore must persist restored entities' files.
  releaseService.setEntityStore(entityStore);
  // M28 Git Sync — best-effort mirroring of release create/push into the user's
  // git repo. Probes `pages.root` for the worktree; reads config per-action.
  const gitService = new GitService(cwd, pages.root);
  // M25 Release Push — coordinates M17 bundle build + M24 transport; owns release_push.
  const releasePushService = new ReleasePushService(
    db.handle,
    releaseService,
    remoteAuthService,
    gitService,
    cwd,
  );
  pluginHost.registerMcpServer('release-tools', () =>
    createReleaseToolsServer({ releaseService, gitService, ws: gateway }),
  );

  // M27 Project Clone — bootstrap-time only. Runs after services exist (DB
  // migrated, plugin host mounted, pages root ensured) but BEFORE watchers start
  // and before app.listen, so restore writes land without watcher double-capture.
  if (opts.clone) {
    const importService = new ReleaseImportService(db.handle, releaseService, remoteHttpClient, cwd);
    try {
      const result = await importService.clone(opts.clone, { nameOverride: opts.name });
      console.log(
        `  cloned remote project '${opts.clone}' → local release #${result.localReleaseId ?? '?'}`,
      );
    } catch (err) {
      const code = err instanceof DomainError ? err.code : 'CLONE_FAILED';
      console.error(
        `\x1b[31mclone failed\x1b[0m: ${code} — ${err instanceof Error ? err.message : String(err)}`,
      );
      // Full all-or-nothing rollback: cwd returns to its pre-`--clone` state. Close
      // the DB handle first so db.sqlite can be unlinked (required on Windows).
      db.close();
      rollbackClone(cwd, {
        pagesDir,
        configCreated: opts.configCreated ?? false,
        claudeDirCreated: opts.claudeDirCreated ?? false,
        gitignoreCreated: opts.gitignoreCreated ?? false,
      });
      process.exit(1);
    }
  }

  // M21: BriefService — top-level (nie plugin), wzorzec analogiczny do
  // PlanService. Mountowany router /api/briefs poniżej.
  const briefService = new BriefService({
    briefsPages,
    briefsWatcher,
    briefsSerializer,
    pageVersions,
    chatService,
    releaseService,
    frontmatterIndexer: pagesFrontmatterIndexer,
    ws: gateway,
  });

  // M23: PatchService — top-level (nie plugin), wzorzec analogiczny do
  // BriefService. Mountowany router /api/patches poniżej.
  const patchService = new PatchService({
    patchesPages,
    patchesWatcher,
    patchesSerializer,
    pageVersions,
    chatService,
    frontmatterIndexer: pagesFrontmatterIndexer,
  });

  app.use('/api', pluginHostRouter(pluginHost));
  app.use('/api/pages', pagesRouter(pages, watcher, pageVersions));
  app.use('/api/static', staticRouter(staticHtml));
  app.use('/api/tags', tagsRouter(tagsService, referencesService));
  app.use('/api/references', referencesRouter(referencesService));
  app.use('/api/entities', entitiesRouter(tagsService, versionService, entityStore));
  // Wspolne deps tury agenta — `threadsRouter` (POST /:id/ask) i `chatRouter`
  // (POST /api/chat, SSE) dziela ten sam runtime i rejestr `activeAdapters`.
  const agentDeps = {
    chatService,
    pagesService: pages,
    tagsService,
    sectionsService,
    planService,
    briefService,
    patchService,
    pageVersions,
    skillResolver,
    skillRegistry,
    ws: gateway,
    cwd,
    pagesDir,
    mode,
    db,
  };
  app.use('/api/threads', threadsRouter(agentDeps));
  app.use('/api/sections', sectionsRouter(sectionsService));
  app.use('/api/todos', todosRouter(todosIndexer));
  app.use('/api/page-links', pageLinksRouter(pagesLinkIndexer));
  app.use('/api/plans', plansRouter(planService));
  app.use('/api/releases', releasesRouter(releaseService, gateway, gitService));
  app.use('/api/release-pushes', releasePushesRouter(releasePushService));
  app.use('/api/git', gitRouter(gitService));
  app.use('/api/briefs', briefsRouter(briefService, pageVersions));
  app.use('/api/patches', patchesRouter(patchService));
  app.use('/api/remote-account', remoteAccountRouter(remoteAuthService));
  app.use('/api/remote-project', remoteProjectRouter(remoteAuthService, cwd));
  app.use('/api/chat', chatRouter(agentDeps));
  app.use(errorHandler);

  watcher.onChange((relPath, kind) => {
    if (kind === 'unlink') {
      sectionIndexer.handleUnlink(relPath).catch((err) => {
        console.error('[section-indexer] unlink error:', err);
      });
      todosIndexer.handleUnlink(relPath);
      pagesLinkIndexer.handleUnlink(relPath);
      pagesFrontmatterIndexer.handleUnlink('pages', relPath);
      // M17: capture filesystem-origin delete (chokidar saw external rm)
      pageVersions.recordVersion(relPath, 'delete', 'filesystem').catch((err) => {
        console.warn(`[page-version] watcher delete capture for ${relPath}:`, (err as Error).message);
      });
    } else {
      sectionIndexer.schedulePage(relPath);
      todosIndexer.schedulePage(relPath);
      pagesLinkIndexer.schedulePage(relPath);
      pagesFrontmatterIndexer.schedulePage('pages', relPath);
      // M17: capture filesystem-origin add/change. `kind === 'add'` may be a
      // real new file (op=create) or a re-detection — pageVersions.hasAny
      // distinguishes.
      const op: 'create' | 'update' = kind === 'add' && !pageVersions.hasAny(relPath) ? 'create' : 'update';
      pageVersions.recordVersion(relPath, op, 'filesystem').catch((err) => {
        console.warn(`[page-version] watcher capture for ${relPath}:`, (err as Error).message);
      });
    }
  });

  // M21 m02multidir: drugi watcher dla briefsDir. Tylko frontmatter indexer
  // + page_version (z dedykowanym briefsSerializer). Section/todos/pages-link
  // indexery NIE pracuja na briefsDir (briefs to nie pages w sensie M02 →
  // nie czesc nawigowalnego drzewa, nie agreguja section_ref/todo'ow do tabel).
  briefsWatcher.onChange((relPath, kind) => {
    if (kind === 'unlink') {
      pagesFrontmatterIndexer.handleUnlink('briefs', relPath);
      pageVersions.recordVersion(relPath, 'delete', 'filesystem', undefined, briefsSerializer, 'brief').catch((err) => {
        console.warn(`[page-version] brief delete capture for ${relPath}:`, (err as Error).message);
      });
    } else {
      pagesFrontmatterIndexer.schedulePage('briefs', relPath);
      const op: 'create' | 'update' = kind === 'add' && !pageVersions.hasAny(relPath) ? 'create' : 'update';
      pageVersions.recordVersion(relPath, op, 'filesystem', undefined, briefsSerializer, 'brief').catch((err) => {
        console.warn(`[page-version] brief capture for ${relPath}:`, (err as Error).message);
      });
      // Direct disk edit (not suppressed): refresh open BriefEditors. The indexer
      // only fires `briefs:changed` on frontmatter changes, so body-only edits
      // need this explicit broadcast. `external` → reload-or-confirm like Pages.
      gateway.broadcast({ kind: 'briefs:changed', path: relPath, origin: 'external' });
    }
  });

  // M23: trzeci watcher dla patchesDir — analogicznie do briefsWatcher.
  patchesWatcher.onChange((relPath, kind) => {
    if (kind === 'unlink') {
      pagesFrontmatterIndexer.handleUnlink('patches', relPath);
      pageVersions.recordVersion(relPath, 'delete', 'filesystem', undefined, patchesSerializer, 'patch').catch((err) => {
        console.warn(`[page-version] patch delete capture for ${relPath}:`, (err as Error).message);
      });
    } else {
      pagesFrontmatterIndexer.schedulePage('patches', relPath);
      const op: 'create' | 'update' = kind === 'add' && !pageVersions.hasAny(relPath) ? 'create' : 'update';
      pageVersions.recordVersion(relPath, op, 'filesystem', undefined, patchesSerializer, 'patch').catch((err) => {
        console.warn(`[page-version] patch capture for ${relPath}:`, (err as Error).message);
      });
    }
  });

  // M29: external edits / git pull of entity files → incremental reindex.
  entitiesWatcher.onChange((relPath, kind) => {
    if (kind === 'unlink') {
      entityIndexer.handleUnlink(relPath).catch((err) => {
        console.error(`[entity-indexer] unlink ${relPath}:`, err);
      });
    } else {
      entityIndexer.schedulePage(relPath);
    }
  });

  watcher.start();
  briefsWatcher.start();
  patchesWatcher.start();

  sectionIndexer.indexAll().catch((err) => {
    console.error('[section-indexer] initial indexAll failed:', err);
  });

  todosIndexer.indexAll().catch((err) => {
    console.error('[todos-indexer] initial indexAll failed:', err);
  });

  pagesLinkIndexer.indexAll().catch((err) => {
    console.error('[pages-link-indexer] initial indexAll failed:', err);
  });

  // M17: initial sync of page_version. For each markdown file with no captured
  // version — or whose latest captured version is a `delete` tombstone while the
  // file is back on disk — write an `op = 'create'` baseline. The latter case
  // covers delete+recreate that happened while the server wasn't watching
  // (server down, `git checkout` between restarts): without this, the phantom
  // `delete` stays the latest row and release diffs show the page as removed.
  (async () => {
    try {
      const files = await pages.listMarkdownFiles();
      for (const relPath of files) {
        const latest = pageVersions.getLatestForPath(relPath);
        if (latest && latest.op !== 'delete') continue;
        await pageVersions.recordVersion(relPath, 'create', 'filesystem');
      }
    } catch (err) {
      console.warn('[page-version] initial sync failed:', (err as Error).message);
    }
  })();

  // M21: initial sync — page_version baseline dla briefów + frontmatter indexer.
  (async () => {
    try {
      const files = await briefsPages.listMarkdownFiles();
      for (const relPath of files) {
        if (pageVersions.hasAny(relPath)) continue;
        await pageVersions.recordVersion(relPath, 'create', 'filesystem', undefined, briefsSerializer, 'brief');
      }
    } catch (err) {
      console.warn('[page-version] briefs initial sync failed:', (err as Error).message);
    }
    // M23: initial sync — page_version baseline dla patchy.
    try {
      const files = await patchesPages.listMarkdownFiles();
      for (const relPath of files) {
        if (pageVersions.hasAny(relPath)) continue;
        await pageVersions.recordVersion(relPath, 'create', 'filesystem', undefined, patchesSerializer, 'patch');
      }
    } catch (err) {
      console.warn('[page-version] patches initial sync failed:', (err as Error).message);
    }
    try {
      await pagesFrontmatterIndexer.indexAll();
    } catch (err) {
      console.warn('[pages-frontmatter-indexer] initial sync failed:', (err as Error).message);
    }
  })();

  // M29: entity store boot. (1) one-time DB→text export for pre-M29 projects
  // whose entities live only in SQLite; (2) rebuild the derived index from the
  // committed files. Awaited BEFORE listen() — the app is entity-centric, so
  // serving REST/MCP before the index is ready would 404 / return empty.
  try {
    const fileEntityCount = entityStore.listAll().length;
    const hasTagsFile = entityStore.readTags().length > 0;
    const dbEntityCount = rawReader
      .listTypes()
      .filter((t) => pluginHost.getEntity(t))
      .reduce((n, t) => n + rawReader.listSlugs(t).length, 0);
    const filesPresent = fileEntityCount > 0 || hasTagsFile;

    if (!filesPresent && dbEntityCount > 0) {
      // Pre-M29 project: entities live only in SQLite → export to text once.
      console.log(`[m29] exporting ${dbEntityCount} entities DB→text into ${entitiesDir} ...`);
      backupDbBeforeMigration(cwd);
      for (const type of rawReader.listTypes()) {
        if (!pluginHost.getEntity(type)) continue;
        for (const slug of rawReader.listSlugs(type)) entityStore.persist(type, slug);
      }
      entityStore.persistTags();
    } else if (filesPresent && dbEntityCount > 0 && fileEntityCount !== dbEntityCount) {
      // Edge (brief migrt001 §3): committed files differ from a non-empty DB
      // (e.g. a git pull dropped/added entities). Files win on rebuild — back up
      // the derived DB first so the prior index is recoverable.
      console.warn(
        `[m29] entity file count (${fileEntityCount}) != DB count (${dbEntityCount}); rebuilding from files (db backed up)`,
      );
      backupDbBeforeMigration(cwd);
    }

    await entityIndexer.indexAll();
  } catch (err) {
    console.error('[entity-indexer] boot indexAll failed:', err);
  }
  // M29: enable tags.json persistence only AFTER the boot rebuild, so any
  // auto-created tag during indexAll does not write files mid-rebuild.
  tagsService.setEntityStore(entityStore);
  // M29: enable slug-rename propagation into entity files (dto→endpoint
  // linked_dtos, *→ac verifies). After indexAll so the index is consistent.
  referencesService.setEntityDeps(db.handle, entityStore);
  // Start the entities watcher only after the boot export/rebuild, so bulk
  // self-writes during export never race a live reindex.
  entitiesWatcher.start();

  const closeAssets = mode === 'dev' ? await mountDevVite(app, cwd) : mountProd(app, cwd);

  const port = await listenOrExit(httpServer, portRef.current);
  portRef.current = port;
  const url = `http://localhost:${port}`;

  const writingStyle = initialWritingStyle
    ? { slug: initialWritingStyle, title: skillRegistry.resolve(initialWritingStyle).metadata.title }
    : null;

  return {
    url,
    port,
    writingStyle,
    shutdown: async () => {
      await watcher.close();
      await briefsWatcher.close();
      await patchesWatcher.close();
      await entitiesWatcher.close();
      await gateway.close();
      await closeAssets();
      db.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

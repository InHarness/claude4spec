import express, { type Express } from 'express';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { readConfig, writeConfig } from './config.js';
import { openDb, type Db } from './db/index.js';
import { PagesService } from './services/pages.js';
import { pagesRouter } from './routes/pages.js';
import { tagsRouter } from './routes/tags.js';
import { entitiesRouter } from './core/plugin-host/entities-router.js';
import { referencesRouter } from './routes/references.js';
import { TagsService } from './services/tags.js';
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
import { PagesFrontmatterIndexer } from './services/pages-frontmatter-indexer.js';
import { SectionIndexerService } from './services/section-indexer.js';
import { TodosIndexerService } from './services/todos-indexer.js';
import { PagesLinkIndexerService } from './services/pages-link-indexer.js';
import { PageSerializer } from './services/page-serializer.js';
import { PageVersionService } from './services/page-version.js';
import { RawEntityReader } from './domain/raw-entity-reader.js';
import { ReleaseService } from './services/release.js';
import { releasesRouter } from './routes/releases.js';
import { createReleaseToolsServer } from './mcp/release-tools/index.js';
import { WsGateway } from './ws/gateway.js';
import { PagesWatcher } from './fs/watcher.js';
import { createReferenceToolsServer } from './mcp/reference-tools.js';
import { SkillRegistry, SkillResolver, findSkillsDir } from './services/skill-registry.js';
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
        `port ${port} zajęty — zatrzymaj drugą instancję lub zmień port w config.json / przekaż --port`,
      );
      process.exit(1);
    }
    throw err;
  }
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
    res.sendFile(path.join(clientDist, 'index.html'));
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

  const skillRegistry = SkillRegistry.load(findSkillsDir());
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
  const chatService = new ChatService(db.handle);
  // Orphan cleanup: rowsy chat_message.status='streaming' pozostale po crashu poprzedniego
  // procesu (SIGKILL/OOM) — brak aktywnego adaptera po starcie, flipujemy wszystkie na 'complete'.
  chatService.finalizeAllStreamingRows();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode, cwd });
  });

  app.get('/api/meta', (_req, res) => {
    res.json({ cwd, cwdName: path.basename(cwd) });
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
    });
  });

  app.patch('/api/config', (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Partial<{ name: string; writingStyle: string | null; onboardingCompleted: boolean }> = {};

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

      const updated = writeConfig(cwd, patch);
      res.json({
        name: updated.name,
        port: portRef.current,
        pagesDir: updated.pagesDir,
        mode,
        writingStyle: updated.writingStyle,
        onboarding: { completed: updated.onboardingCompleted },
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
  // mounts its router, registers its MCP server, and wires its id resolver via
  // the supplied MountContext. Inactive plugins are skipped (config.entities).
  pluginHost.mountBackend({
    app,
    db: db.handle,
    ws: gateway,
    tagsService,
    versionService,
    referencesService,
    registerMcpServer: (name, server) => pluginHost.registerMcpServer(name, server),
    setIdResolver: (type, fn) => pluginHost.setIdResolver(type, fn),
    registerEntityService: (type, service) => pluginHost.registerEntityService(type, service),
  });

  // Cross-cutting MCP server — owned by the host, not a plugin (M13).
  const referenceToolsServer = createReferenceToolsServer({
    tagsService,
    referencesService,
    pagesService: pages,
    sectionsService,
    ws: gateway,
    db: db.handle,
    cwd,
  });
  pluginHost.registerMcpServer('reference-tools', referenceToolsServer);

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
  );
  const releaseToolsServer = createReleaseToolsServer({ releaseService, ws: gateway });
  pluginHost.registerMcpServer('release-tools', releaseToolsServer);

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
  app.use('/api/tags', tagsRouter(tagsService, referencesService));
  app.use('/api/references', referencesRouter(referencesService));
  app.use('/api/entities', entitiesRouter(tagsService, versionService));
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
  app.use('/api/releases', releasesRouter(releaseService, gateway));
  app.use('/api/briefs', briefsRouter(briefService, pageVersions));
  app.use('/api/patches', patchesRouter(patchService));
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
      await gateway.close();
      await closeAssets();
      db.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

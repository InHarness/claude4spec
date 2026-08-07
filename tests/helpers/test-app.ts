import express, { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb } from './test-db.js';
import { applyProjection } from '../../src/server/db/projection.js';
import { PluginRegistryImpl } from '../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../src/server/serialization/registerAll.js';
import { loadBuiltinEnvelopes } from '../../src/server/core/plugin-host/loader.js';
import { entitiesRouter } from '../../src/server/core/plugin-host/entities-router.js';
import { metaRouter } from '../../src/server/routes/meta.js';
import { patchesRouter } from '../../src/server/routes/patches.js';
import { tagsRouter } from '../../src/server/routes/tags.js';
import { referencesRouter } from '../../src/server/routes/references.js';
import { generatedCrudRouter } from '../../src/server/core/plugin-host/generated-crud-router.js';
import { registerRefRewriteListeners } from '../../src/server/core/plugin-host/manifest-adapter.js';
import {
  genericCreate,
  genericDelete,
  genericMutateCollectionAxis,
  genericUpdate,
  genericWriteCollectionWindow,
  propagateRename,
} from '../../src/server/core/plugin-host/generic-crud.js';
import type { CrudFacade } from '../../src/server/core/plugin-host/types.js';
import { plansRouter } from '../../src/server/routes/plans.js';
import { artifactsRouter } from '../../src/server/routes/artifacts.js';
import { PlanService } from '../../src/server/services/plan.js';
import { BriefService } from '../../src/server/services/brief.js';
import { PatchService } from '../../src/server/services/patch.js';
import { ChatService } from '../../src/server/services/chat.js';
import { TagsService } from '../../src/server/services/tags.js';
import { VersionService } from '../../src/server/services/versions.js';
import { ReferencesService } from '../../src/server/services/references.js';
import { RawEntityReader } from '../../src/server/discovery/raw-entity-reader.js';
import { PagesService } from '../../src/server/services/pages.js';
import { FileWatchRuntime, type WatchScope } from '../../src/server/fs/watcher.js';
import { pageSource, artifactSource, boundWriter, boundSuppress, ENTITIES_SOURCE } from '../../src/server/fs/sources.js';
import { FileSerializer } from '../../src/server/services/file-serializer.js';
import { FileVersionService } from '../../src/server/services/file-version.js';
import { PagesFrontmatterIndexer } from '../../src/server/services/pages-frontmatter-indexer.js';
import { BRIEF_ROOT_MARKER, PATCH_ROOT_MARKER, PLAN_ROOT_MARKER } from '../../src/shared/types.js';
import { EntityStore } from '../../src/server/services/entity-store.js';
import { errorHandler } from '../../src/server/routes/errors.js';
import { createDiscoveryCore } from '../../src/server/discovery/index.js';
import { SerializationEngine } from '../../src/server/core/plugin-host/serialization-engine.js';
import { sectionSerializer } from '../../src/server/serialization/serializers/section.js';
import type { WsEmitter } from '../../src/server/ws/project-emitter.js';
import type { ReleaseService } from '../../src/server/services/release.js';
import type { BackendModule, ProjectPluginHost } from '../../src/server/core/plugin-host/types.js';
import type Database from 'better-sqlite3';
import { projectMcpRouter } from '../../src/server/routes/mcp.js';
import { createReferenceToolsServer } from '../../src/server/mcp/reference-tools.js';
import { createEntityToolsServer } from '../../src/server/mcp/entity-tools.js';
import type { ExternalSurfaceDeps } from '../../src/server/mcp/surface.js';
import type { ChatContextType } from '../../src/shared/entities.js';

/** One synthetic context scope for the whole harness — production uses `context:<projectId>`. */
const TEST_SCOPE: WatchScope = 'context:test';

export interface TestApp {
  app: express.Express;
  db: Database.Database;
  host: ProjectPluginHost;
  rawReader: RawEntityReader;
  versionService: VersionService;
  referencesService: ReferencesService;
  entityStore: EntityStore;
  /** 0.2.4: exposed so a test can build a real EntityIndexerService for round-trip checks. */
  tagsService: TagsService;
  watchRuntime: FileWatchRuntime;
  /** A.8: the write door a plugin's `mount` is handed, so a test can drive it. */
  crud: CrudFacade;
  /** Every `ws` message the mounted backend emitted, in order. */
  broadcasts: unknown[];
  cwd: string;
  /** M36 plan mount — exposed so tests can seed `.md` files directly (mirrors artifacts.test.ts's writeArtifact). */
  plansPages: PagesService;
  plansSerializer: FileSerializer;
  pageVersions: FileVersionService;
  frontmatterIndexer: PagesFrontmatterIndexer;
  /** 0.2.13: the external MCP surface's deps, for tests that compose it directly. */
  mcpSurfaceDeps: (profile: ChatContextType) => ExternalSurfaceDeps;
  cleanup: () => void;
}

/**
 * Composes the same backend building blocks production mounts in
 * buildProjectContext (mountBackend + entitiesRouter) on top of an in-memory
 * db and a throwaway tmp dir. Watchers are constructed but never started —
 * starting chokidar here would leak fds across the fork pool. Do NOT import
 * project-context.ts (it registers section_ref at import time).
 */
export async function createTestApp(opts: { extraModules?: BackendModule[] } = {}): Promise<TestApp> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-test-'));
  const db = createTestDb();

  const registry = new PluginRegistryImpl();
  registerAllPlugins(registry);
  // 0.2.2: `endpoint` and `dto` arrive through the loader now, not
  // `registerAllPlugins`. Loading the envelopes keeps every test that writes one
  // exercising the real registration path. Requires the built bundle — `pretest`.
  await loadBuiltinEnvelopes(registry);
  // Test-only fixture types (e.g. proving generic capture works for a
  // plugin-contributed type) are registered before consolidate() so they
  // behave identically to core types for the rest of this function.
  for (const mod of opts.extraModules ?? []) registry.registerEntityModule(mod);
  const host = registry.consolidate(null);

  /**
   * Recorded rather than dropped: the broadcast is the only part of the crud
   * facade a caller cannot observe through the database or the entity file, so
   * a wrapper that forgot it looked identical to one that did not — and every
   * open client would keep rendering the pre-write state until a manual reload.
   */
  const broadcasts: unknown[] = [];
  const ws: WsEmitter = { broadcast: (msg) => void broadcasts.push(msg) };
  const tagsService = new TagsService(db);
  const versionService = new VersionService(db);
  const rawReader = new RawEntityReader(db, host);
  versionService.configureSnapshot(rawReader, host);

  const watchRuntime = new FileWatchRuntime({ fsEvents: false });
  const scopedWatch = watchRuntime.scoped(TEST_SCOPE);
  const entitiesAbs = path.join(cwd, '.claude4spec/entities');
  watchRuntime.mountSource({ source: ENTITIES_SOURCE, dir: entitiesAbs, scope: TEST_SCOPE });
  const entityStore = new EntityStore(
    cwd,
    '.claude4spec/entities',
    boundSuppress(scopedWatch, ENTITIES_SOURCE),
    rawReader,
    host,
  );
  entityStore.ensureRoot();

  const pages = new PagesService(cwd, 'pages', 'pages');
  await pages.ensureRoot();
  watchRuntime.mountSource({ source: pageSource('pages'), dir: pages.root, scope: TEST_SCOPE });
  const pagesWriter = boundWriter(scopedWatch, pageSource('pages'));
  // 0.1.96: ReferencesService is bound to the reference-validated roots (here just
  // the built-in 'pages' root) keyed by rootId.
  const referencesService = new ReferencesService(
    new Map([['pages', pages]]),
    new Map([['pages', pagesWriter]]),
  );
  /**
   * 2.0.0: build the projection before anything mounts, over every AVAILABLE
   * module — the same call, in the same place, that `buildProjectContext` makes.
   * `createTestDb` covers only the four directly-built-in types, because it is
   * synchronous and the envelope loads asynchronously; this is where `endpoint`,
   * `dto`, `endpoint_dto` and any `extraModules` fixture get their tables.
   */
  applyProjection(db, host.listAvailable());

  /**
   * 2.0.0 (A.8) — the same two handles `buildProjectContext` puts on the mount
   * context, built here for the same reason: `ctx.db` is gone, and a plugin's
   * own router writes through the host's declarative door.
   */
  const crudDeps = {
    host,
    reader: rawReader,
    tags: tagsService,
    store: entityStore,
    references: referencesService,
    projection: { db, store: entityStore, versions: versionService },
  };
  /**
   * Mirrors `buildProjectContext` exactly, INCLUDING `propagateRename` and the
   * broadcast. A helper that bound the verbs bare would make every test pass
   * against a facade production does not have — which is how the missing
   * rename fan-out survived its first review.
   */
  const crudFacade: CrudFacade = {
    create: async (type, input, actor) => {
      const result = genericCreate(crudDeps, type, input, actor);
      ws.broadcast({ kind: 'entity:changed', entityType: type, slug: result.slug });
      return result;
    },
    update: async (type, slug, input, actor) => {
      const result = genericUpdate(crudDeps, type, slug, input, actor);
      await propagateRename(crudDeps, type, slug, result.slug);
      ws.broadcast({ kind: 'entity:changed', entityType: type, slug: result.slug });
      return result;
    },
    delete: async (type, slug, actor) => {
      const result = genericDelete(crudDeps, type, slug, actor);
      ws.broadcast({ kind: 'entity:changed', entityType: type, slug });
      return result;
    },
    writeCollectionWindow: async (type, slug, field, entries, actor) => {
      const result = genericWriteCollectionWindow(crudDeps, type, slug, field, entries, actor);
      ws.broadcast({ kind: 'entity:changed', entityType: type, slug });
      return result;
    },
    mutateCollectionAxis: async (type, slug, field, axisKey, op, at, actor) => {
      const result = genericMutateCollectionAxis(crudDeps, type, slug, field, axisKey, op, at, actor);
      ws.broadcast({ kind: 'entity:changed', entityType: type, slug });
      return result;
    },
  };

  const router = Router();
  host.mountBackend({
    app: router,
    reader: rawReader,
    crud: crudFacade,
    host,
    cwd,
    ws,
    tagsService,
    versionService,
    referencesService,
    entityStore,
    registerMcpServer: (name, server) => host.registerMcpServer(name, server),
    registerEntityService: (type, service) => host.registerEntityService(type, service),
    registerRenameListener: (fn) => host.registerRenameListener(fn),
  });
  // M29: slug-rename propagation into entity files, as in production. Must come
  // after mountBackend — that is when modules contribute their rename listeners.
  referencesService.setPluginHost(host);
  // 2.0.0 (A.8): rename listeners are registered over every module here, not
  // from inside each type's mount. Mirrors `buildProjectContext`.
  registerRefRewriteListeners(host, db, entityStore);
  /**
   * A real core, so an integration test can reach the keyed-collection routes
   * `entitiesRouter` mounts and the generated CRUD routes below. Pages are
   * still absent — standing up a page source here would couple every API test
   * to the page fixtures — but SERIALIZATION is wired as of 0.2.9 item 31: the
   * generated routes answer with L9 views, so a core without an engine makes
   * every one of them a 500.
   */
  const serializationEngine = new SerializationEngine(host, sectionSerializer);
  const discovery = createDiscoveryCore({
    reader: rawReader,
    db,
    host,
    serialization: serializationEngine,
    roots: [],
    projectDir: cwd,
    packageVersion: '0.0.0-test',
  } as never);
  /**
   * 0.2.13: the two host-owned MCP servers `project-context.ts` registers, which
   * this harness previously left out because nothing read `buildMcpServers()`.
   * The external MCP surface does, and without these it composed the read half
   * of the catalog and silently none of the write half — so a gating test would
   * have passed by having nothing to withhold.
   *
   * `release-tools` is deliberately absent: it needs a `ReleaseService`, which
   * this harness does not build.
   */
  host.registerMcpServer('reference-tools', () =>
    createReferenceToolsServer({ pluginHost: host, tagsService, referencesService, discovery, ws, entityStore }),
  );
  host.registerMcpServer('entity-tools', () =>
    createEntityToolsServer({
      host,
      reader: rawReader,
      discovery,
      db,
      ws,
      referencesService,
      tagsService,
      entityStore,
      versionService,
    }),
  );
  router.use('/entities', entitiesRouter(host, tagsService, versionService, entityStore, rawReader, discovery));
  /**
   * 0.2.13 — the catalog's new `rest` renderings, mirroring `project-context.ts`.
   * `/_meta` carries only the four M39 operations here; the activation and
   * plugin-diagnostic routes that share the prefix in production belong to
   * `pluginHostRouter`, which this harness does not mount.
   */
  router.use('/_meta', metaRouter(discovery));
  router.use('/tags', tagsRouter(tagsService, referencesService));
  router.use('/references', referencesRouter(host, referencesService, discovery));
  router.use(
    '/patches',
    patchesRouter({
      briefsDirAbs: path.join(cwd, 'briefs'),
      patchesDirAbs: path.join(cwd, 'patches'),
    }),
  );

  /**
   * Host API 2.0.0 (item 31) — mirrors `project-context.ts`, INCLUDING the
   * order: after `mountBackend` above, so a type whose own `backend.routes`
   * still serves a CRUD verb keeps serving it and the generated router only
   * answers what is left. A test app that mounted these first would prove the
   * opposite of what production does.
   */
  for (const module of host.listEntities()) {
    if (!module.data?.schema) continue;
    router.use(
      module.pathPrefix,
      generatedCrudRouter({ ...crudDeps, discovery, ws }, module),
    );
  }

  // M36 artifact mounts (briefs/patches/plans) — minimal wiring so tests can
  // exercise the generic /api/artifacts/:kind/* family alongside each kind's
  // bespoke routes (e.g. plansRouter's create-thread).
  const chatService = new ChatService(db);
  const briefsPages = new PagesService(cwd, 'briefs', BRIEF_ROOT_MARKER);
  await briefsPages.ensureRoot();
  const patchesPages = new PagesService(cwd, 'patches', PATCH_ROOT_MARKER);
  await patchesPages.ensureRoot();
  const plansPages = new PagesService(cwd, 'plans', PLAN_ROOT_MARKER);
  await plansPages.ensureRoot();
  for (const kind of ['brief', 'patch', 'plan'] as const) {
    const dir = { brief: briefsPages, patch: patchesPages, plan: plansPages }[kind].root;
    watchRuntime.mountSource({ source: artifactSource(kind), dir, scope: TEST_SCOPE });
  }
  const briefsWatcher = boundWriter(scopedWatch, artifactSource('brief'));
  const patchesWatcher = boundWriter(scopedWatch, artifactSource('patch'));
  const plansWatcher = boundWriter(scopedWatch, artifactSource('plan'));
  const briefsSerializer = new FileSerializer(briefsPages);
  const patchesSerializer = new FileSerializer(patchesPages);
  const plansSerializer = new FileSerializer(plansPages);
  const pageVersions = new FileVersionService(db, briefsSerializer);
  const frontmatterIndexer = new PagesFrontmatterIndexer(
    new Map([
      [BRIEF_ROOT_MARKER, briefsPages],
      [PATCH_ROOT_MARKER, patchesPages],
      [PLAN_ROOT_MARKER, plansPages],
    ]),
    ws,
  );
  const briefService = new BriefService({
    briefsPages,
    briefsWatcher,
    briefsSerializer,
    pageVersions,
    chatService,
    releaseService: {} as unknown as ReleaseService,
    frontmatterIndexer,
    ws,
  });
  const patchService = new PatchService({
    patchesPages,
    patchesWatcher,
    patchesSerializer,
    pageVersions,
    chatService,
    frontmatterIndexer,
  });
  const planService = new PlanService({
    plansPages,
    plansWatcher,
    plansSerializer,
    pageVersions,
    chatService,
    frontmatterIndexer,
    ws,
  });
  router.use('/plans', plansRouter(planService));
  router.use('/artifacts', artifactsRouter({ brief: briefService, patch: patchService, plan: planService, pageVersions, chat: chatService }));

  /**
   * 0.2.13 external MCP surface, composed from the same locals the routers
   * above use — the harness mirrors production's `mcpSurfaceDeps`, so a test
   * that reaches an operation over MCP is reaching the same code path a test
   * reaching it over REST does.
   */
  const mcpSurfaceDeps = (profile: ChatContextType): ExternalSurfaceDeps => ({
    profile,
    reader: { reader: rawReader, discovery, db, projectDir: cwd, packageVersion: '0.0.0-test' },
    pluginHost: host,
    planService,
    pageVersions,
    briefService,
    listProjects: () => ({ projects: [] }),
    workspaceName: 'default',
  });
  router.use('/mcp', projectMcpRouter('0.0.0-test', mcpSurfaceDeps));
  router.use(errorHandler);

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', router);

  return {
    app,
    db,
    host,
    rawReader,
    versionService,
    referencesService,
    entityStore,
    tagsService,
    watchRuntime,
    crud: crudFacade,
    broadcasts,
    cwd,
    plansPages,
    plansSerializer,
    pageVersions,
    frontmatterIndexer,
    mcpSurfaceDeps,
    cleanup: () => {
      db.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    },
  };
}

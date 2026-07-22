import express, { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb } from './test-db.js';
import { PluginRegistryImpl } from '../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../src/server/serialization/registerAll.js';
import { entitiesRouter } from '../../src/server/core/plugin-host/entities-router.js';
import { plansRouter } from '../../src/server/routes/plans.js';
import { artifactsRouter } from '../../src/server/routes/artifacts.js';
import { PlanService } from '../../src/server/services/plan.js';
import { BriefService } from '../../src/server/services/brief.js';
import { PatchService } from '../../src/server/services/patch.js';
import { ChatService } from '../../src/server/services/chat.js';
import { TagsService } from '../../src/server/services/tags.js';
import { VersionService } from '../../src/server/services/versions.js';
import { ReferencesService } from '../../src/server/services/references.js';
import { RawEntityReader } from '../../src/server/domain/raw-entity-reader.js';
import { PagesService } from '../../src/server/services/pages.js';
import { PagesWatcher } from '../../src/server/fs/watcher.js';
import { FileSerializer } from '../../src/server/services/file-serializer.js';
import { FileVersionService } from '../../src/server/services/file-version.js';
import { PagesFrontmatterIndexer } from '../../src/server/services/pages-frontmatter-indexer.js';
import { BRIEF_ROOT_MARKER, PATCH_ROOT_MARKER, PLAN_ROOT_MARKER } from '../../src/shared/types.js';
import { EntitiesWatcher } from '../../src/server/fs/entities-watcher.js';
import { EntityStore } from '../../src/server/services/entity-store.js';
import { errorHandler } from '../../src/server/routes/errors.js';
import type { WsEmitter } from '../../src/server/ws/project-emitter.js';
import type { ReleaseService } from '../../src/server/services/release.js';
import type { BackendModule, ProjectPluginHost } from '../../src/server/core/plugin-host/types.js';
import type Database from 'better-sqlite3';

export interface TestApp {
  app: express.Express;
  db: Database.Database;
  host: ProjectPluginHost;
  rawReader: RawEntityReader;
  versionService: VersionService;
  referencesService: ReferencesService;
  entityStore: EntityStore;
  cwd: string;
  /** M36 plan mount — exposed so tests can seed `.md` files directly (mirrors artifacts.test.ts's writeArtifact). */
  plansPages: PagesService;
  plansSerializer: FileSerializer;
  pageVersions: FileVersionService;
  frontmatterIndexer: PagesFrontmatterIndexer;
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
  // Test-only fixture types (e.g. proving generic capture works for a
  // plugin-contributed type) are registered before consolidate() so they
  // behave identically to core types for the rest of this function.
  for (const mod of opts.extraModules ?? []) registry.registerEntityModule(mod);
  const host = registry.consolidate(null);

  const ws: WsEmitter = { broadcast: () => {} };
  const tagsService = new TagsService(db);
  const versionService = new VersionService(db);
  const rawReader = new RawEntityReader(db, host);
  versionService.configureSnapshot(rawReader, host);

  const entitiesWatcher = new EntitiesWatcher(path.join(cwd, '.claude4spec/entities'));
  const entityStore = new EntityStore(cwd, '.claude4spec/entities', entitiesWatcher, rawReader, host);
  entityStore.ensureRoot();

  const pages = new PagesService(cwd, 'pages', 'pages');
  await pages.ensureRoot();
  const watcher = new PagesWatcher(pages.root, ws, 'pages');
  // 0.1.96: ReferencesService is bound to the reference-validated roots (here just
  // the built-in 'pages' root) keyed by rootId.
  const referencesService = new ReferencesService(
    new Map([['pages', pages]]),
    new Map([['pages', watcher]]),
  );
  // M29: wire the entity-file deps so slug-rename propagation (e.g. design-system
  // → ui-view designSystemSlug) runs as it does in production.
  referencesService.setEntityDeps(db, entityStore);

  const router = Router();
  host.mountBackend({
    app: router,
    db,
    host,
    cwd,
    ws,
    tagsService,
    versionService,
    referencesService,
    entityStore,
    registerMcpServer: (name, server) => host.registerMcpServer(name, server),
    registerEntityService: (type, service) => host.registerEntityService(type, service),
  });
  router.use('/entities', entitiesRouter(host, tagsService, versionService, entityStore, rawReader));

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
  const briefsWatcher = new PagesWatcher(briefsPages.root, ws, BRIEF_ROOT_MARKER);
  const patchesWatcher = new PagesWatcher(patchesPages.root, ws, PATCH_ROOT_MARKER);
  const plansWatcher = new PagesWatcher(plansPages.root, ws, PLAN_ROOT_MARKER);
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
    cwd,
    plansPages,
    plansSerializer,
    pageVersions,
    frontmatterIndexer,
    cleanup: () => {
      db.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    },
  };
}

import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { readConfig } from '../config.js';
import { openDb, type Db } from '../db/index.js';
import { PagesService } from '../services/pages.js';
import { pagesRouter } from '../routes/pages.js';
import { StaticHtmlService } from '../services/static-html.js';
import { staticRouter } from '../routes/static.js';
import { tagsRouter } from '../routes/tags.js';
import { entitiesRouter } from '../core/plugin-host/entities-router.js';
import { referencesRouter } from '../routes/references.js';
import { TagsService, DomainError } from '../services/tags.js';
import { VersionService } from '../services/versions.js';
import { ReferencesService } from '../services/references.js';
import { ChatService } from '../services/chat.js';
import { AgentCredentialService } from '../services/agent-credential.js';
import { SectionsService } from '../services/sections.js';
import { registerExtensionReferenceType } from '../../shared/reference-extensions.js';
import { SUPPORTED_LANGUAGES, isSupportedLanguage } from '../../shared/languages.js';
import { PlanService } from '../services/plan.js';
import { plansRouter } from '../routes/plans.js';
import { BriefService } from '../services/brief.js';
import { briefsRouter } from '../routes/briefs.js';
import { PatchService } from '../services/patch.js';
import { patchesRouter } from '../routes/patches.js';
import { RemoteAuthService } from '../services/remote-auth.js';
import { RemoteHttpClient, assertRemoteApiReachable } from '../services/remote-http-client.js';
import { remoteAccountRouter } from '../routes/remote-account.js';
import { agentRouter } from '../routes/agent-credential.js';
import { remoteProjectRouter } from '../routes/remote-project.js';
import { PagesFrontmatterIndexer } from '../services/pages-frontmatter-indexer.js';
import { SectionIndexerService } from '../services/section-indexer.js';
import { TodosIndexerService } from '../services/todos-indexer.js';
import { PagesLinkIndexerService } from '../services/pages-link-indexer.js';
import { PageSerializer } from '../services/page-serializer.js';
import { PageVersionService } from '../services/page-version.js';
import { RawEntityReader } from '../domain/raw-entity-reader.js';
import { ReleaseService } from '../services/release.js';
import { releasesRouter } from '../routes/releases.js';
import { ReleasePushService } from '../services/release-push.js';
import { releasePushesRouter } from '../routes/release-pushes.js';
import { ReleaseImportService, rollbackClone } from '../services/release-import.js';
import { createReleaseToolsServer } from '../mcp/release-tools/index.js';
import { GitService } from '../services/git.js';
import { gitRouter } from '../routes/git.js';
import type { WsGateway } from '../ws/gateway.js';
import { PagesWatcher } from '../fs/watcher.js';
import { EntitiesWatcher } from '../fs/entities-watcher.js';
import { EntityStore } from '../services/entity-store.js';
import { EntityIndexerService } from '../services/entity-indexer.js';
import { createReferenceToolsServer } from '../mcp/reference-tools.js';
import { SkillRegistry, SkillResolver, findSkillsRoots } from '../services/skill-registry.js';
import { chatRouter } from '../routes/chat.js';
import { threadsRouter } from '../routes/threads.js';
import { sectionsRouter } from '../routes/sections.js';
import { todosRouter } from '../routes/todos.js';
import { pageLinksRouter } from '../routes/page-links.js';
import { errorHandler } from '../routes/errors.js';
import { configRouter } from '../routes/config.js';
import type { PeerProject } from '../services/chat-context.js';
import type { PluginRegistry, ProjectPluginHost } from '../core/plugin-host/types.js';
import { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { sectionSerializer } from '../serialization/serializers/section.js';
import { pluginHostRouter } from '../core/plugin-host/cross-cutting.js';
import type { ActiveAdapter, PendingInput } from '../routes/agent-turn.js';
import { ProjectWsEmitter } from '../ws/project-emitter.js';
import { projectIdForCwd } from './project-id.js';
import { ensureWelcomePage } from './bootstrap.js';
import type { WorkspaceRegistry } from './registry.js';
import type { WorkspaceRecord } from './types.js';

// M06 registers <section_ref/> as the 6th XML reference type via the M19
// extension reference types slot. Registration is PROCESS-level (tag shape is
// static); the per-project anchor validation lives in reference-tools, which
// owns a per-context SectionsService — a validate closure here would leak one
// project's sections into every other context (M31).
registerExtensionReferenceType({
  tag: 'section_ref',
  attrOrder: ['anchor'],
});

/**
 * M29: one-time best-effort backup of the derived SQLite before a DB→text
 * export / divergent-rebuild, so the prior index is recoverable. Idempotent —
 * skips if the `.pre-migration.bak` already exists. M31: follows the workspace
 * slot path (the DB no longer lives in the project dir).
 */
function backupDbBeforeMigration(slotDir: string): void {
  const src = path.join(slotDir, 'db.sqlite');
  const bak = path.join(slotDir, 'db.sqlite.pre-migration.bak');
  try {
    if (fs.existsSync(src) && !fs.existsSync(bak)) fs.copyFileSync(src, bak);
  } catch (err) {
    console.warn('[m29] db backup failed:', (err as Error).message);
  }
}

export interface ProjectContextDeps {
  registry: WorkspaceRegistry;
  /** Process-immutable plugin catalog — consolidated per context. */
  pluginRegistry: PluginRegistry;
  workspace: WorkspaceRecord;
  cwd: string;
  gateway: WsGateway;
  mode: 'dev' | 'prod';
  /** Resolved `--remote-url` value (flag > config.json); null/absent ⇒ prod constant. */
  remoteApiUrl?: string | null;
  /** CLI `--pages` override — effective only for the CLI-started project. */
  pagesDirOverride?: string;
  /** M31: pinged when an agent turn finishes — context-cache idle-retry hook. */
  onTurnFinished?: () => void;
  /** M31: PATCH /config touched a context-defining field → cache.invalidate(projectId). */
  onContextConfigChanged?: () => void;
  /** M27: bootstrap-time clone — runs inside build, before watchers start. */
  clone?: {
    slug: string;
    nameOverride?: string;
    configCreated: boolean;
    claudeDirCreated: boolean;
    gitignoreCreated: boolean;
  };
}

export interface ProjectContext {
  projectId: string;
  cwd: string;
  workspace: WorkspaceRecord;
  /** Per-context Express Router — dispatch middleware mounts it under /api/projects/:id. */
  router: Router;
  db: Db;
  pluginHost: ProjectPluginHost;
  /** L9 dispatch bound to this context's host. */
  serialization: SerializationEngine;
  /** Per-project room emitter (all services broadcast through it). */
  ws: ProjectWsEmitter;
  /** M31: per-project agent-turn registries (chat/threads routers + cache guard). */
  activeAdapters: Map<string, ActiveAdapter>;
  pendingInputs: Map<string, PendingInput>;
  writingStyle: { slug: string; title: string } | null;
  /** True while any agent turn runs in this project (LRU dispose guard). */
  hasInFlightTurn: () => boolean;
  dispose: () => Promise<void>;
}

/**
 * M31: builds one fully-wired project — DB, services, watchers, indexers and
 * the per-context router. Mechanical carve of the former startServer body;
 * handlers are byte-identical, only the mount prefixes lost their `/api`.
 * Await cost ≈ entityIndexer.indexAll() (<1s budget); section/todos/link
 * indexers stay fire-and-forget.
 */
export async function buildProjectContext(deps: ProjectContextDeps): Promise<ProjectContext> {
  // Partial-build cleanup: resources acquired before a build failure (db
  // handle, watcher fds) are released in reverse order — a failed build is
  // cached as a 500 for THIS project only and must leak nothing.
  const cleanup: Array<() => unknown> = [];
  try {
    return await buildInner(deps, cleanup);
  } catch (err) {
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch {
        /* best-effort */
      }
    }
    throw err;
  }
}

async function buildInner(
  deps: ProjectContextDeps,
  cleanup: Array<() => unknown>,
): Promise<ProjectContext> {
  const { registry, workspace, cwd, gateway, mode } = deps;
  const projectId = projectIdForCwd(cwd);
  const router = Router();
  // M31: every former WsGateway consumer now broadcasts into this project's
  // room only — the emitter is signature-compatible (`broadcast(event)`).
  const ws = new ProjectWsEmitter(gateway, projectId);
  // M31: per-project agent-turn registries (was module-global in agent-turn.ts).
  const activeAdapters = new Map<string, ActiveAdapter>();
  const pendingInputs = new Map<string, PendingInput>();

  const skillRegistry = SkillRegistry.load(findSkillsRoots(cwd));
  const bootConfig = readConfig(cwd);
  // Effective pagesDir precedence: CLI flag > config.json > hardcoded 'pages'.
  const pagesDir = deps.pagesDirOverride ?? bootConfig.pagesDir ?? 'pages';
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
  // `--remote-url` flag (deps) > config.json > prod constant. The prod-constant
  // fallback lives in RemoteHttpClient; here `null` means "use prod".
  const remoteApiUrl = deps.remoteApiUrl ?? bootConfig.remoteApiUrl;
  // M24: an explicit remoteApiUrl override (flag or config.json) must be a valid,
  // reachable host — hard error at build, no fallback to the production constant.
  // M31: failure is a per-project build failure (500), not a boot failure.
  if (remoteApiUrl != null && remoteApiUrl.trim() !== '') {
    await assertRemoteApiReachable(remoteApiUrl);
  }
  const pluginHost: ProjectPluginHost = deps.pluginRegistry.consolidate(bootConfig.entities);
  const hostState = pluginHost.partition();
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
  // 0.1.51: fail fast on a hand-edited language value outside SUPPORTED_LANGUAGES so
  // a bogus display name never reaches the system prompt. PATCH /config enforces
  // the same membership at runtime.
  if (bootConfig.language !== null && !isSupportedLanguage(bootConfig.language)) {
    throw new Error(
      `config.json: language "${bootConfig.language}" not supported. Available: ${SUPPORTED_LANGUAGES.join(', ')}`,
    );
  }
  const initialConvLang = bootConfig.agent?.conversationalLanguage ?? null;
  if (initialConvLang !== null && !isSupportedLanguage(initialConvLang)) {
    throw new Error(
      `config.json: agent.conversationalLanguage "${initialConvLang}" not supported. Available: ${SUPPORTED_LANGUAGES.join(', ')}`,
    );
  }
  const skillResolver = new SkillResolver(skillRegistry, cwd);

  const db: Db = openDb(workspace, cwd);
  cleanup.push(() => db.close());
  const dbSlotDir = registry.slotDir(workspace, projectId);
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
  // client per project context; base URL from config.remoteApiUrl (or the prod constant).
  const remoteHttpClient = new RemoteHttpClient(remoteApiUrl);
  const remoteAuthService = new RemoteAuthService(db.handle, remoteHttpClient);
  const chatService = new ChatService(db.handle);
  // M05 0.1.62: user's own ANTHROPIC API key (single-row, encrypted at-rest).
  const agentCredentialService = new AgentCredentialService(db.handle);
  // Orphan cleanup: rowsy chat_message.status='streaming' pozostale po crashu poprzedniego
  // procesu (SIGKILL/OOM) — brak aktywnego adaptera po starcie, flipujemy wszystkie na 'complete'.
  chatService.finalizeAllStreamingRows();

  const watcher = new PagesWatcher(pages.root, ws);
  cleanup.push(() => watcher.close());
  // M21 m02multidir: drugi PagesWatcher na briefsDir. Wspoldzieli ten sam
  // gateway (broadcast `page:changed` z drugiego katalogu — UI może slot-detect
  // przez prefix sciezki, jezeli kiedys bedzie potrzebne).
  const briefsWatcher = new PagesWatcher(briefsPages.root, ws);
  cleanup.push(() => briefsWatcher.close());
  // M23 m02multidir: trzeci PagesWatcher na patchesDir.
  const patchesWatcher = new PagesWatcher(patchesPages.root, ws);
  cleanup.push(() => patchesWatcher.close());
  // M29: dedicated watcher + file store + indexer for the committed entity store.
  // The page-family watchers above are rooted outside `.claude4spec/`, so this
  // watcher owns `<entitiesDir>` exclusively.
  const entitiesWatcher = new EntitiesWatcher(entitiesAbs);
  cleanup.push(() => entitiesWatcher.close());
  const entityStore = new EntityStore(cwd, entitiesDir, entitiesWatcher, rawReader, pluginHost);
  entityStore.ensureRoot();
  const entityIndexer = new EntityIndexerService(
    db.handle,
    entityStore,
    entitiesWatcher,
    ws,
    pluginHost,
    tagsService,
    rawReader,
  );
  const referencesService = new ReferencesService(pages, watcher);
  const sectionsService = new SectionsService(db.handle);
  sectionsService.setWriteDeps({ pages, watcher });

  const planService = new PlanService(db.handle, ws, chatService);
  const sectionIndexer = new SectionIndexerService(db.handle, pages, watcher, ws, pluginHost);
  const todosIndexer = new TodosIndexerService(pages, ws);
  const pagesLinkIndexer = new PagesLinkIndexerService(pages, ws);
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
    ws,
  );

  // Mount all active backend modules — each plugin constructs its own service,
  // mounts its router, registers its MCP server, and registers its entity
  // service via the supplied MountContext. Inactive plugins are skipped
  // (config.entities).
  pluginHost.mountBackend({
    app: router,
    db: db.handle,
    host: pluginHost,
    cwd,
    ws,
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
      pluginHost,
      tagsService,
      referencesService,
      pagesService: pages,
      sectionsService,
      ws,
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
    createReleaseToolsServer({ releaseService, gitService, ws }),
  );

  // M27 Project Clone — bootstrap-time only. Runs after services exist (DB
  // migrated, plugin host mounted, pages root ensured) but BEFORE watchers start
  // and before listen, so restore writes land without watcher double-capture.
  if (deps.clone) {
    const importService = new ReleaseImportService(db.handle, releaseService, remoteHttpClient, cwd);
    try {
      const result = await importService.clone(deps.clone.slug, { nameOverride: deps.clone.nameOverride });
      console.log(
        `  cloned remote project '${deps.clone.slug}' → local release #${result.localReleaseId ?? '?'}`,
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
        configCreated: deps.clone.configCreated,
        claudeDirCreated: deps.clone.claudeDirCreated,
        gitignoreCreated: deps.clone.gitignoreCreated,
        dbSlotDir,
      });
      process.exit(1);
    }
  }

  // M21: BriefService — top-level (nie plugin), wzorzec analogiczny do
  // PlanService. Mountowany router /briefs poniżej.
  const briefService = new BriefService({
    briefsPages,
    briefsWatcher,
    briefsSerializer,
    pageVersions,
    chatService,
    releaseService,
    frontmatterIndexer: pagesFrontmatterIndexer,
    ws,
  });

  // M23: PatchService — top-level (nie plugin), wzorzec analogiczny do
  // BriefService. Mountowany router /patches poniżej.
  const patchService = new PatchService({
    patchesPages,
    patchesWatcher,
    patchesSerializer,
    pageVersions,
    chatService,
    frontmatterIndexer: pagesFrontmatterIndexer,
  });

  // Per-context config/meta/writing-styles (carved out of startServer inline
  // handlers — single response builder in routes/config.ts).
  router.use(
    configRouter({
      cwd,
      skillRegistry,
      onContextConfigChanged: deps.onContextConfigChanged,
      onOnboardingCompleted: (effectivePagesDir) => ensureWelcomePage(cwd, effectivePagesDir),
    }),
  );

  router.use(pluginHostRouter(pluginHost));
  router.use('/pages', pagesRouter(pages, watcher, pageVersions));
  router.use('/static', staticRouter(staticHtml));
  router.use('/tags', tagsRouter(tagsService, referencesService));
  router.use('/references', referencesRouter(pluginHost, referencesService));
  router.use('/entities', entitiesRouter(pluginHost, tagsService, versionService, entityStore));
  // 0.1.58: peer-discovery for the `<workspace_projects>` prompt block. For each
  // workspace project except this one, build a PeerProject whose `path` is the
  // registry `cwd` (passed 1:1 as the `project` param to `c4s-tools.ask`); name/
  // description are lazily read from the peer's config.json (source of truth,
  // no denormalization). Unreadable config → entry with `path` only. Re-read per
  // turn so peer-config edits surface on the next thread's first turn.
  const listWorkspacePeers = (): PeerProject[] => {
    const ws = registry.getWorkspace(workspace.name);
    if (!ws) return [];
    return ws.projects
      .filter((p) => p.cwd !== cwd)
      .map((p) => {
        const peer: PeerProject = { path: p.cwd };
        try {
          const peerCfg = readConfig(p.cwd);
          if (peerCfg.name) peer.name = peerCfg.name;
          if (peerCfg.description) peer.description = peerCfg.description;
        } catch {
          /* unreadable/missing config → path-only entry, not an error */
        }
        return peer;
      });
  };

  // Wspolne deps tury agenta — `threadsRouter` (POST /:id/ask) i `chatRouter`
  // (POST /chat, SSE) dziela ten sam runtime i rejestr `activeAdapters`.
  const agentDeps = {
    pluginHost,
    activeAdapters,
    pendingInputs,
    onTurnFinished: deps.onTurnFinished,
    chatService,
    agentCredentialService,
    pagesService: pages,
    tagsService,
    sectionsService,
    planService,
    briefService,
    patchService,
    pageVersions,
    skillResolver,
    skillRegistry,
    ws,
    cwd,
    pagesDir,
    mode,
    db,
    workspaceName: workspace.name,
    listWorkspacePeers,
  };
  router.use('/threads', threadsRouter(agentDeps));
  router.use('/sections', sectionsRouter(sectionsService));
  router.use('/todos', todosRouter(todosIndexer));
  router.use('/page-links', pageLinksRouter(pagesLinkIndexer));
  router.use('/plans', plansRouter(planService));
  router.use('/releases', releasesRouter(releaseService, ws, gitService));
  router.use('/release-pushes', releasePushesRouter(releasePushService));
  router.use('/git', gitRouter(gitService));
  router.use('/briefs', briefsRouter(briefService, pageVersions));
  router.use('/patches', patchesRouter(patchService));
  router.use('/agent', agentRouter(agentCredentialService));
  router.use('/remote-account', remoteAccountRouter(remoteAuthService));
  router.use('/remote-project', remoteProjectRouter(remoteAuthService, cwd));
  router.use('/chat', chatRouter(agentDeps));
  router.use(errorHandler);

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
      ws.broadcast({ kind: 'briefs:changed', path: relPath, origin: 'external' });
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
  // committed files. Awaited BEFORE the context serves — the app is
  // entity-centric, so serving REST/MCP before the index is ready would 404 /
  // return empty.
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
      backupDbBeforeMigration(dbSlotDir);
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
      backupDbBeforeMigration(dbSlotDir);
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

  const writingStyle = initialWritingStyle
    ? { slug: initialWritingStyle, title: skillRegistry.resolve(initialWritingStyle).metadata.title }
    : null;

  return {
    projectId,
    cwd,
    workspace,
    router,
    db,
    pluginHost,
    serialization: new SerializationEngine(pluginHost, sectionSerializer),
    ws,
    activeAdapters,
    pendingInputs,
    writingStyle,
    hasInFlightTurn: () => activeAdapters.size > 0,
    // M31 dispose sequence: watchers → MCP factories → room → db handle.
    dispose: async () => {
      await watcher.close();
      await briefsWatcher.close();
      await patchesWatcher.close();
      await entitiesWatcher.close();
      pluginHost.clearMcpFactories();
      gateway.closeRoom(projectId);
      db.close();
    },
  };
}

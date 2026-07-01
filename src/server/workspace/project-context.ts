import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { readConfig, validateRootDirs } from '../config.js';
import { BRIEF_ROOT_MARKER, PATCH_ROOT_MARKER, type Root } from '../../shared/types.js';
import type { PageRootRuntime } from '../routes/pages.js';
import type { SectionIndexRoot } from '../services/section-indexer.js';
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
import { RemoteHttpClient } from '../services/remote-http-client.js';
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
import type { PluginRegistry, ProjectPluginHost, ProjectPluginOverlay } from '../core/plugin-host/types.js';
import { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { sectionSerializer } from '../serialization/serializers/section.js';
import { pluginHostRouter } from '../core/plugin-host/cross-cutting.js';
import {
  enumerateOverlayPackages,
  loadProjectOverlay,
  projectPluginsDir,
  type ProjectOverlayResult,
} from '../core/plugin-host/overlay-loader.js';
import { PluginWatcher } from '../core/plugin-host/plugin-watcher.js';
import { buildBasePluginPackages } from '../routes/plugins.js';
import type { PluginLoadRecord } from '../core/plugin-host/loader.js';
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

// v0.1.64 registers <diagram/> as the 7th XML reference type via the M19
// extension slot. `caption` is a per-reference attribute (not stored on the
// entity); `slug` identifies the diagram entity. No validate closure — broken
// diagram references surface through the generic entity-reference matching
// (tagMatchesEntity) like any other static reference.
registerExtensionReferenceType({
  tag: 'diagram',
  attrOrder: ['slug', 'caption'],
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

/**
 * M33 phase 3: map changed overlay paths back to the package dir name(s) under
 * `<cwd>/.claude4spec/plugins/`. A change anywhere inside `plugins/<pkg>/...`
 * (or to the dir itself) attributes to `<pkg>`.
 */
function affectedOverlayPackages(pluginsDir: string, changedPaths: string[]): string[] {
  const pkgs = new Set<string>();
  for (const p of changedPaths) {
    const rel = path.relative(pluginsDir, p);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const seg = rel.split(path.sep)[0];
    if (seg) pkgs.add(seg);
  }
  return [...pkgs];
}

export interface ProjectContextDeps {
  registry: WorkspaceRegistry;
  /** Process-immutable plugin catalog — consolidated per context. */
  pluginRegistry: PluginRegistry;
  /** M33: base-layer (workspace/npm) loader records, for per-project /_meta/plugins. */
  pluginRecords: PluginLoadRecord[];
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
  // 0.1.96: page roots come from config.roots[]. The CLI --pages override
  // applies to the built-in 'pages' root's dir only.
  const effectiveRoots: Root[] = bootConfig.roots.map((r) =>
    r.id === 'pages' && deps.pagesDirOverride ? { ...r, dir: deps.pagesDirOverride } : r,
  );
  // M21: briefsDir, default '.claude4spec/briefs'. Must be relative, must not escape cwd.
  const briefsDir = bootConfig.briefsDir ?? '.claude4spec/briefs';
  if (path.isAbsolute(briefsDir)) {
    throw new Error(`config.json: briefsDir must be relative to cwd, got: ${briefsDir}`);
  }
  const briefsAbs = path.resolve(cwd, briefsDir);
  const briefsRel = path.relative(cwd, briefsAbs);
  if (briefsRel.startsWith('..') || path.isAbsolute(briefsRel)) {
    throw new Error(`config.json: briefsDir must not escape project root, got: ${briefsDir}`);
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

  // 0.1.96: cross-field root overlap validation. Hard errors abort the build
  // (mirrors the PATCH /api/config guard); soft warnings (vs briefs/patches) log.
  {
    const { errors, warnings } = validateRootDirs(effectiveRoots, { entitiesDir, briefsDir, patchesDir });
    for (const w of warnings) console.warn(`[config] ${w}`);
    if (errors.length > 0) throw new Error(errors[0]);
    // Briefs/patches are distinct catalogs — an identical dir double-captures every
    // file into page_version under both markers. Warn (the PATCH route hard-400s).
    if (path.resolve(cwd, briefsDir) === path.resolve(cwd, patchesDir)) {
      console.warn(
        `[config] briefsDir === patchesDir ("${briefsDir}") — brief/patch files will be double-indexed`,
      );
    }
  }
  // M01 (0.1.36): resolve the remote base URL with precedence
  // `--remote-url` flag (deps) > config.json > prod constant. The prod-constant
  // fallback lives in RemoteHttpClient; here `null` means "use prod".
  // M24 (0.1.65): an explicit remoteApiUrl override (flag or config.json) is only
  // syntax-validated at config load; the client bootstrap is cold — no network probe
  // here. An unreachable-but-valid host lets the project build succeed; the
  // reachability error surfaces at the first remote action as a graceful failure.
  const remoteApiUrl = deps.remoteApiUrl ?? bootConfig.remoteApiUrl;

  // M33 phase 2: project-local plugin overlay, behind the machine-local
  // `trustProjectPlugins` gate. Untrusted/undecided ⇒ no overlay is built and no
  // project-committed code runs; its types stay out of the effective pool and are
  // reported as `untrusted` in /_meta/plugins. The trust prompt surfaces on the
  // client when `localPluginsPresent && trust === undefined`.
  const localPackages = enumerateOverlayPackages(cwd);
  const localPluginsPresent = localPackages.length > 0;
  const trust = registry.getProjectTrust(workspace, projectId);
  let overlay: ProjectPluginOverlay | undefined;
  let overlayRecords: PluginLoadRecord[] = [];
  let overlayResult: ProjectOverlayResult | undefined;
  if (localPluginsPresent && trust === true) {
    overlayResult = await loadProjectOverlay(cwd);
    overlay = overlayResult.overlay;
    overlayRecords = overlayResult.records;
  } else if (localPluginsPresent) {
    overlayRecords = localPackages.map((pkg) => ({
      package: pkg,
      status: 'skipped' as const,
      code: 'PLUGIN_PROJECT_UNTRUSTED' as const,
      reason: 'project plugins not trusted on this machine (trustProjectPlugins)',
      layer: 'overlay' as const,
      trust: 'untrusted' as const,
      origin: path.join('.claude4spec', 'plugins', pkg),
    }));
  }

  // M15 phase 2: fan plugin-contributed writing styles into this project's
  // SkillRegistry as `source: "plugin"` (precedence project > global > plugin >
  // bundled). Base (workspace/npm) styles always; project-local overlay styles
  // only on the trusted path (overlayResult is set only when trust === true),
  // so an untrusted plugin contributes no style — exactly as for its entities.
  for (const style of deps.pluginRegistry.listWritingStyles()) skillRegistry.addPluginStyle(style);
  for (const style of overlayResult?.writingStyles ?? []) skillRegistry.addPluginStyle(style);

  const pluginHost: ProjectPluginHost = deps.pluginRegistry.consolidate(
    { entities: bootConfig.entities },
    overlay,
  );
  const hostState = pluginHost.partition();
  console.log(
    `[plugin-host] active: [${hostState.active.join(', ') || '∅'}]` +
      (hostState.inactive.length ? `, inactive: [${hostState.inactive.join(', ')}]` : '') +
      (hostState.unknown.length ? `, unknown: [${hostState.unknown.join(', ')}]` : ''),
  );
  const initialWritingStyle = bootConfig.writingStyle;
  if (initialWritingStyle !== null && !skillRegistry.isSelectable(initialWritingStyle)) {
    throw new Error(
      `config.json: writingStyle "${initialWritingStyle}" ${skillRegistry.unselectableReason(initialWritingStyle)}`,
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

  // 0.1.96: one runtime (PagesService + StaticHtmlService + PagesWatcher +
  // PageSerializer) per configured page root. The built-in 'pages' root is
  // always present; user roots are additive. Every per-directory behaviour is
  // gated on the root's PROPERTIES below, never on `root.id === 'pages'`.
  interface RootRuntime {
    root: Root;
    pages: PagesService;
    staticHtml: StaticHtmlService;
    watcher: PagesWatcher;
    serializer: PageSerializer;
  }
  const rootRuntimes: RootRuntime[] = [];
  for (const root of effectiveRoots) {
    const pagesSvc = new PagesService(cwd, root.dir, root.id);
    await pagesSvc.ensureRoot();
    const staticSvc = new StaticHtmlService(cwd, root.dir);
    const rootWatcher = new PagesWatcher(pagesSvc.root, ws, root.id);
    cleanup.push(() => rootWatcher.close());
    rootRuntimes.push({
      root,
      pages: pagesSvc,
      staticHtml: staticSvc,
      watcher: rootWatcher,
      serializer: new PageSerializer(pagesSvc),
    });
  }
  const rootById = new Map(rootRuntimes.map((rt) => [rt.root.id, rt]));
  // The built-in 'pages' runtime backs the many single-root consumers that still
  // take one PagesService/PagesWatcher/PageSerializer (release restore, entity
  // reference-tools, current-page fetch, etc.).
  const pagesRuntime = rootById.get('pages')!;
  const pages = pagesRuntime.pages;
  const watcher = pagesRuntime.watcher;
  const pageSerializer = pagesRuntime.serializer;

  // M21/M23: briefs & patches are NOT roots — they reuse the same primitive on
  // dedicated instances and carry the fixed 'brief'/'patch' page_version markers.
  const briefsPages = new PagesService(cwd, briefsDir, BRIEF_ROOT_MARKER);
  await briefsPages.ensureRoot();
  const patchesPages = new PagesService(cwd, patchesDir, PATCH_ROOT_MARKER);
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

  // Per-root PagesWatchers live in rootRuntimes (created above). Briefs/patches
  // keep their own dedicated watchers, carrying the 'brief'/'patch' markers.
  const briefsWatcher = new PagesWatcher(briefsPages.root, ws, BRIEF_ROOT_MARKER);
  cleanup.push(() => briefsWatcher.close());
  const patchesWatcher = new PagesWatcher(patchesPages.root, ws, PATCH_ROOT_MARKER);
  cleanup.push(() => patchesWatcher.close());
  // M29: dedicated watcher + file store + indexer for the committed entity store.
  // The page-family watchers above are rooted outside `.claude4spec/`, so this
  // watcher owns `<entitiesDir>` exclusively.
  const entitiesWatcher = new EntitiesWatcher(entitiesAbs);
  cleanup.push(() => entitiesWatcher.close());
  // M33 phase 3: hot-reload watcher for the project-local plugin overlay
  // (axis B — pool composition). Mounted ONLY behind the trust gate, so an
  // untrusted/undecided repo never reloads project-committed plugin code
  // without consent. On a debounced change it invalidates THIS context (the
  // next build re-imports with a fresh content-hash cache-bust → new pool) and
  // broadcasts `plugin:reloaded` so the editor remounts extensions without a
  // document reset. In-flight turns finish on the captured (old) context.
  const overlayVersionByPkg = new Map(
    overlayRecords.filter((r) => r.manifestVersion).map((r) => [r.package, r.manifestVersion!]),
  );
  const pluginOverlayWatcher = new PluginWatcher(
    trust === true ? [projectPluginsDir(cwd)] : [],
    (changedPaths) => {
      const pkgs = affectedOverlayPackages(projectPluginsDir(cwd), changedPaths);
      // Invalidating THIS context retires it; the rebuilt context mounts its own
      // fresh watcher. Stop this one now so a retired-but-not-yet-disposed
      // context (in-flight turn) can't keep re-invalidating the projectId that
      // the new context now owns.
      void pluginOverlayWatcher.close();
      deps.onContextConfigChanged?.();
      // Broadcast only for changes attributable to a package — no empty-name
      // event when a change doesn't map to a plugin dir.
      for (const pkg of pkgs) {
        ws.broadcast({
          kind: 'plugin:reloaded',
          name: pkg,
          version: overlayVersionByPkg.get(pkg) ?? '',
          tier: 'overlay',
        });
      }
    },
  );
  cleanup.push(() => pluginOverlayWatcher.close());
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
  // 0.1.96: per-behaviour root maps (gated on root PROPERTIES, not id).
  const sectionIndexedRoots = new Map<string, SectionIndexRoot>();
  const referenceValidatedServices = new Map<string, PagesService>();
  const referenceValidatedWatchers = new Map<string, PagesWatcher>();
  const sidebarRoots = new Map<string, PagesService>(); // todos: any root with a visible tree
  const allRootServices = new Map<string, PagesService>();
  for (const rt of rootRuntimes) {
    allRootServices.set(rt.root.id, rt.pages);
    if (rt.root.sectionIndexed) sectionIndexedRoots.set(rt.root.id, { pages: rt.pages, watcher: rt.watcher });
    if (rt.root.referenceValidated) {
      referenceValidatedServices.set(rt.root.id, rt.pages);
      referenceValidatedWatchers.set(rt.root.id, rt.watcher);
    }
    if (rt.root.sidebar !== 'hidden') sidebarRoots.set(rt.root.id, rt.pages);
  }

  const referencesService = new ReferencesService(referenceValidatedServices, referenceValidatedWatchers);
  const sectionsService = new SectionsService(db.handle);
  sectionsService.setWriteDeps(sectionIndexedRoots);

  const planService = new PlanService(db.handle, ws, chatService);
  const sectionIndexer = new SectionIndexerService(db.handle, sectionIndexedRoots, ws, pluginHost);
  const todosIndexer = new TodosIndexerService(sidebarRoots, ws);
  // pages-link indexer covers every page root (autocomplete/meta), resolving links
  // within each root (self-scope); cross-root @-scope is applied client-side.
  const pagesLinkIndexer = new PagesLinkIndexerService(allRootServices, ws);
  // M21/M23 serializers for briefs/patches (own PagesService-bound instances).
  const briefsSerializer = new PageSerializer(briefsPages);
  const patchesSerializer = new PageSerializer(patchesPages);
  // M17: page versioning — shared instance; per-root serializer + rootId passed per recordVersion.
  const pageVersions = new PageVersionService(db.handle, pageSerializer);
  // M21/M23: in-memory frontmatter indexer over every page root + the brief/patch markers.
  const frontmatterRoots = new Map<string, PagesService>(allRootServices);
  frontmatterRoots.set(BRIEF_ROOT_MARKER, briefsPages);
  frontmatterRoots.set(PATCH_ROOT_MARKER, patchesPages);
  const pagesFrontmatterIndexer = new PagesFrontmatterIndexer(frontmatterRoots, ws);

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
  // 0.1.96: releasable roots drive releases/bundles/diffs and git staging.
  const releasableRootIds = effectiveRoots.filter((r) => r.releasable).map((r) => r.id);
  const releasableRootDirs = effectiveRoots.filter((r) => r.releasable).map((r) => path.resolve(cwd, r.dir));
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
    releasableRootIds,
  );
  // M29: release restore must persist restored entities' files.
  releaseService.setEntityStore(entityStore);
  // M28 Git Sync — best-effort mirroring of release create/push into the user's
  // git repo. Probes the releasable roots for a worktree; reads config per-action.
  const gitService = new GitService(cwd, releasableRootDirs);
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
        rootDirs: effectiveRoots.map((r) => r.dir),
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
      // M33 phase 3: lets the PATCH handler classify a `plugins` write by each
      // field's `kind` — an `executive` field invalidates the context (rebuild),
      // a `hot-reload` field does not (parity with writingStyle/language).
      pluginSettingsSections: () => pluginHost.listSettings(),
    }),
  );

  router.use(
    pluginHostRouter({
      host: pluginHost,
      registry,
      workspace,
      projectId,
      basePackages: buildBasePluginPackages(deps.pluginRegistry, deps.pluginRecords),
      overlayRecords,
      localPluginsPresent,
      trust,
      onContextConfigChanged: deps.onContextConfigChanged,
    }),
  );
  // 0.1.96: pages/static routers resolve a per-root runtime from the `:rootId`
  // segment; unknown id → 404 ROOT_NOT_FOUND.
  const resolveRoot = (rootId: string): PageRootRuntime | undefined => {
    const rt = rootById.get(rootId);
    return rt ? { root: rt.root, pages: rt.pages, watcher: rt.watcher } : undefined;
  };
  const resolveStatic = (rootId: string): StaticHtmlService | undefined => rootById.get(rootId)?.staticHtml;
  router.use('/pages/:rootId', pagesRouter(resolveRoot, pageVersions));
  router.use('/static/:rootId', staticRouter(resolveStatic));
  router.use('/tags', tagsRouter(tagsService, referencesService));
  router.use('/references', referencesRouter(pluginHost, referencesService));
  router.use('/entities', entitiesRouter(pluginHost, tagsService, versionService, entityStore, rawReader));
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
    releaseService,
    pageVersions,
    skillResolver,
    skillRegistry,
    ws,
    cwd,
    roots: effectiveRoots,
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

  // 0.1.96: one fan-out per root. Indexers are invoked only when the root's
  // property gates them (sectionIndexed / sidebar-visible / referenceValidated);
  // page_version + frontmatter always capture, with the root's id + serializer.
  for (const rt of rootRuntimes) {
    const rootId = rt.root.id;
    rt.watcher.onChange((relPath, kind) => {
      if (kind === 'unlink') {
        if (rt.root.sectionIndexed) {
          sectionIndexer.handleUnlink(rootId, relPath).catch((err) => {
            console.error('[section-indexer] unlink error:', err);
          });
        }
        if (rt.root.sidebar !== 'hidden') todosIndexer.handleUnlink(rootId, relPath);
        pagesLinkIndexer.handleUnlink(rootId, relPath);
        pagesFrontmatterIndexer.handleUnlink(rootId, relPath);
        // M17: capture filesystem-origin delete (chokidar saw external rm)
        pageVersions.recordVersion(relPath, 'delete', 'filesystem', undefined, rt.serializer, rootId).catch((err) => {
          console.warn(`[page-version] watcher delete capture for ${rootId}:${relPath}:`, (err as Error).message);
        });
      } else {
        if (rt.root.sectionIndexed) sectionIndexer.schedulePage(rootId, relPath);
        if (rt.root.sidebar !== 'hidden') todosIndexer.schedulePage(rootId, relPath);
        pagesLinkIndexer.schedulePage(rootId, relPath);
        pagesFrontmatterIndexer.schedulePage(rootId, relPath);
        // M17: capture filesystem-origin add/change. `kind === 'add'` may be a
        // real new file (op=create) or a re-detection — pageVersions.hasAny distinguishes.
        const op: 'create' | 'update' = kind === 'add' && !pageVersions.hasAny(relPath, rootId) ? 'create' : 'update';
        pageVersions.recordVersion(relPath, op, 'filesystem', undefined, rt.serializer, rootId).catch((err) => {
          console.warn(`[page-version] watcher capture for ${rootId}:${relPath}:`, (err as Error).message);
        });
      }
    });
  }

  // M21 m02multidir: drugi watcher dla briefsDir. Tylko frontmatter indexer
  // + page_version (z dedykowanym briefsSerializer). Section/todos/pages-link
  // indexery NIE pracuja na briefsDir (briefs to nie pages w sensie M02 →
  // nie czesc nawigowalnego drzewa, nie agreguja section_ref/todo'ow do tabel).
  briefsWatcher.onChange((relPath, kind) => {
    if (kind === 'unlink') {
      pagesFrontmatterIndexer.handleUnlink(BRIEF_ROOT_MARKER, relPath);
      pageVersions.recordVersion(relPath, 'delete', 'filesystem', undefined, briefsSerializer, BRIEF_ROOT_MARKER).catch((err) => {
        console.warn(`[page-version] brief delete capture for ${relPath}:`, (err as Error).message);
      });
    } else {
      pagesFrontmatterIndexer.schedulePage(BRIEF_ROOT_MARKER, relPath);
      const op: 'create' | 'update' = kind === 'add' && !pageVersions.hasAny(relPath, BRIEF_ROOT_MARKER) ? 'create' : 'update';
      pageVersions.recordVersion(relPath, op, 'filesystem', undefined, briefsSerializer, BRIEF_ROOT_MARKER).catch((err) => {
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
      pagesFrontmatterIndexer.handleUnlink(PATCH_ROOT_MARKER, relPath);
      pageVersions.recordVersion(relPath, 'delete', 'filesystem', undefined, patchesSerializer, PATCH_ROOT_MARKER).catch((err) => {
        console.warn(`[page-version] patch delete capture for ${relPath}:`, (err as Error).message);
      });
    } else {
      pagesFrontmatterIndexer.schedulePage(PATCH_ROOT_MARKER, relPath);
      const op: 'create' | 'update' = kind === 'add' && !pageVersions.hasAny(relPath, PATCH_ROOT_MARKER) ? 'create' : 'update';
      pageVersions.recordVersion(relPath, op, 'filesystem', undefined, patchesSerializer, PATCH_ROOT_MARKER).catch((err) => {
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

  for (const rt of rootRuntimes) rt.watcher.start();
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
    for (const rt of rootRuntimes) {
      try {
        const files = await rt.pages.listMarkdownFiles();
        for (const relPath of files) {
          const latest = pageVersions.getLatestForPath(relPath, undefined, rt.root.id);
          if (latest && latest.op !== 'delete') continue;
          await pageVersions.recordVersion(relPath, 'create', 'filesystem', undefined, rt.serializer, rt.root.id);
        }
      } catch (err) {
        console.warn(`[page-version] initial sync failed for root '${rt.root.id}':`, (err as Error).message);
      }
    }
  })();

  // M21: initial sync — page_version baseline dla briefów + frontmatter indexer.
  (async () => {
    try {
      const files = await briefsPages.listMarkdownFiles();
      for (const relPath of files) {
        if (pageVersions.hasAny(relPath, BRIEF_ROOT_MARKER)) continue;
        await pageVersions.recordVersion(relPath, 'create', 'filesystem', undefined, briefsSerializer, BRIEF_ROOT_MARKER);
      }
    } catch (err) {
      console.warn('[page-version] briefs initial sync failed:', (err as Error).message);
    }
    // M23: initial sync — page_version baseline dla patchy.
    try {
      const files = await patchesPages.listMarkdownFiles();
      for (const relPath of files) {
        if (pageVersions.hasAny(relPath, PATCH_ROOT_MARKER)) continue;
        await pageVersions.recordVersion(relPath, 'create', 'filesystem', undefined, patchesSerializer, PATCH_ROOT_MARKER);
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
  pluginOverlayWatcher.start();

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
      for (const rt of rootRuntimes) await rt.watcher.close();
      await briefsWatcher.close();
      await patchesWatcher.close();
      await entitiesWatcher.close();
      await pluginOverlayWatcher.close();
      pluginHost.clearMcpFactories();
      // M33 phase 2: drop references to dynamically imported project-local
      // modules (next rebuild re-imports), alongside the MCP factory release.
      overlayResult?.dispose();
      gateway.closeRoom(projectId);
      db.close();
    },
  };
}

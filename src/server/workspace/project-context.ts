import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { migrateConfigToV4, readConfig, resolveDirAbs, validateRootDirs } from '../config.js';
import type { Root } from '../../shared/types.js';
import type { PageRootRuntime } from '../routes/pages.js';
import type { SectionIndexRoot } from '../services/section-indexer.js';
import { openDb, type Db } from '../db/index.js';
import { applyProjection } from '../db/projection.js';
import { PagesService } from '../services/pages.js';
import { crossRootPagesRouter, pagesRouter } from '../routes/pages.js';
import { StaticHtmlService } from '../services/static-html.js';
import { staticRouter } from '../routes/static.js';
import { tagsRouter } from '../routes/tags.js';
import { entitiesRouter } from '../core/plugin-host/entities-router.js';
import { generatedCrudRouter } from '../core/plugin-host/generated-crud-router.js';
import { registerRefRewriteListeners } from '../core/plugin-host/manifest-adapter.js';
import {
  genericCreate,
  genericDelete,
  genericMutateCollectionAxis,
  genericUpdate,
  genericWriteCollectionWindow,
  propagateRename,
} from '../core/plugin-host/generic-crud.js';
import type { CrudFacade } from '../core/plugin-host/types.js';
import { referencesRouter } from '../routes/references.js';
import { TagsService, DomainError } from '../services/tags.js';
import { VersionService } from '../services/versions.js';
import { ReferencesService } from '../services/references.js';
import { ChatService } from '../services/chat.js';
import { AgentCredentialService } from '../services/agent-credential.js';
import { SectionsService } from '../services/sections.js';
import { registerExtensionReferenceType } from '../../shared/reference-extensions.js';
import { SUPPORTED_LANGUAGES, isSupportedLanguage } from '../../shared/languages.js';
import { slugify } from '../../shared/slug.js';
import { PlanService, injectAnchors } from '../services/plan.js';
import { plansRouter } from '../routes/plans.js';
import { backfillPlansToFilesystem } from './plan-migration.js';
import { backfillEntityTimestamps } from './entity-timestamp-backfill.js';
import { BriefService } from '../services/brief.js';
import { briefsRouter } from '../routes/briefs.js';
import { patchesRouter } from '../routes/patches.js';
import { metaRouter } from '../routes/meta.js';
import { listProjects } from './list-projects.js';
import { PatchService } from '../services/patch.js';
import { artifactsRouter } from '../routes/artifacts.js';
import { RemoteAuthService } from '../services/remote-auth.js';
import { RemoteHttpClient } from '../services/remote-http-client.js';
import { remoteAccountRouter } from '../routes/remote-account.js';
import { agentRouter } from '../routes/agent-credential.js';
import { remoteProjectRouter } from '../routes/remote-project.js';
import { PagesFrontmatterIndexer } from '../services/pages-frontmatter-indexer.js';
import { SectionIndexerService } from '../services/section-indexer.js';
import { TodosIndexerService } from '../services/todos-indexer.js';
import { PagesLinkIndexerService } from '../services/pages-link-indexer.js';
import { FileSerializer } from '../services/file-serializer.js';
import { FileVersionService } from '../services/file-version.js';
import { artifactRegistry, type ArtifactKind, type ArtifactRegistryEntry } from '../services/artifact-registry.js';
import { RawEntityReader } from '../discovery/raw-entity-reader.js';
import { createDiscoveryCore, findReferencesAll } from '../discovery/index.js';
import type { DiscoveryCore } from '../discovery/types.js';
import { applyPagesOverride } from '../discovery/pages-override.js';
import { readPackageVersion } from '../../bin/c4s/package-version.js';
import { projectMcpRouter } from '../routes/mcp.js';
import type { ExternalSurfaceDeps } from '../mcp/surface.js';
import type { ChatContextType } from '../../shared/entities.js';
import { ReleaseService } from '../services/release.js';
import { releasesRouter } from '../routes/releases.js';
import { ReleasePushService } from '../services/release-push.js';
import { releasePushesRouter } from '../routes/release-pushes.js';
import { ReleaseImportService, rollbackClone } from '../services/release-import.js';
import { createReleaseToolsServer } from '../mcp/release-tools/index.js';
import { GitService } from '../services/git.js';
import { gitRouter } from '../routes/git.js';
import type { WsGateway } from '../ws/gateway.js';
import type { WatchScope, WatchSubscriber, FileWatchRuntime } from '../fs/watcher.js';
import {
  pageSource,
  artifactSource,
  boundSuppress,
  boundWriter,
  ENTITIES_SOURCE,
  RELEASES_SOURCE,
  PLUGINS_OVERLAY_SOURCE,
  MARKDOWN_FILTER,
  HTML_FILTER,
  JSON_FILTER,
  type SelfWriteMarker,
} from '../fs/sources.js';
import { pageChangedNotifier, htmlPreviewNotifier, artifactChangedNotifier } from '../fs/notifications.js';
import { FileVersionCapture } from '../services/file-version-capture.js';
import { EntityStore } from '../services/entity-store.js';
import { EntityIndexerService } from '../services/entity-indexer.js';
import { ReleaseFileStore, toReleaseFileData } from '../services/release-store.js';
import { ReleaseIndexerService } from '../services/release-indexer.js';
import { createReferenceToolsServer } from '../mcp/reference-tools.js';
import { createPageToolsServer } from '../mcp/page-tools.js';
import type { SectionWriteDeps } from '../services/page-write.js';
import { createEntityToolsServer } from '../mcp/entity-tools.js';
import { SkillRegistry, SkillResolver, findSkillsRoots } from '../services/skill-registry.js';
import { chatRouter } from '../routes/chat.js';
import { threadsRouter } from '../routes/threads.js';
import { sectionsRouter } from '../routes/sections.js';
import { todosRouter } from '../routes/todos.js';
import { pageLinksRouter } from '../routes/page-links.js';
import { errorHandler } from '../routes/errors.js';
import { configRouter } from '../routes/config.js';
import { externalSkillsRouter } from '../routes/external-skills.js';
import type { PeerProject } from '../services/chat-context.js';
import type { PluginRegistry, ProjectPluginHost, ProjectPluginOverlay } from '../core/plugin-host/types.js';
import { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { pluginHostRouter } from '../core/plugin-host/cross-cutting.js';
import {
  enumerateOverlayPackages,
  loadProjectOverlay,
  projectPluginsDir,
  type ProjectOverlayResult,
} from '../core/plugin-host/overlay-loader.js';
import { buildBasePluginPackages } from '../routes/plugins.js';
import type { PluginLoadRecord } from '../core/plugin-host/loader.js';
import type { ActiveAdapter, PendingInput } from '../routes/agent-turn.js';
import { ProjectWsEmitter } from '../ws/project-emitter.js';
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

// 0.2.15 — `<section_ref/>` above is now the ONLY extension reference type in
// the process, and this direct call is the registry's only caller. `<diagram/>`
// used to be the second one (registered here in v0.1.64, then via the entity's
// Slot B in v0.1.129); it is gone, along with both declarative slots. An entity
// contributes no tag: the tags in the registry name no entity at all.

/**
 * M29: one-time best-effort backup of the derived SQLite before a DB→text
 * export / divergent-rebuild, so the prior index is recoverable. Idempotent —
 * skips if the `.pre-migration.bak` already exists. M31: follows the workspace
 * slot path (the DB no longer lives in the project dir). Exported (0.1.127) so
 * `workspace/plan-migration.ts`'s boot-time cutover can reuse it ahead of its
 * own destructive DROP TABLE plan/plan_version.
 */
export function backupDbBeforeMigration(slotDir: string): void {
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
  /** Stable, stored `ProjectRecord.id` — the DB slot / ws-room key. Never re-derived from cwd. */
  projectId: string;
  cwd: string;
  gateway: WsGateway;
  /** M40: the process-wide file-watch runtime. Mounts made here carry `scope: 'context:<id>'`. */
  watchRuntime: FileWatchRuntime;
  mode: 'dev' | 'prod';
  /** Resolved `--remote-url` value (flag > config.json); null/absent ⇒ prod constant. */
  remoteApiUrl?: string | null;
  /** CLI `--pages` override — effective only for the CLI-started project. */
  pagesDirOverride?: string;
  /** M31: pinged when an agent turn finishes — context-cache idle-retry hook. */
  onTurnFinished?: () => void;
  /** M31: PATCH /config touched a context-defining field → cache.invalidate(projectId). */
  onContextConfigChanged?: () => void;
  /** M27: bootstrap-time clone — runs inside build, before mounts dispatch. */
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
  /**
   * 0.2.13: everything the external MCP surface needs, for one profile.
   *
   * Exposed on the context rather than assembled by the caller because the
   * services it names (`planService`, `briefService`, the discovery core…) are
   * locals of `buildInner` and belong to THIS context's lifetime. The workspace
   * mount reaches a project through the cache and calls this; the project-bound
   * mount uses the same function through the per-context router.
   *
   * Calling it does not make the connection a turn: it hands back services, it
   * does not touch `hasInFlightTurn` or pin the context.
   */
  mcpSurfaceDeps: (profile: ChatContextType) => ExternalSurfaceDeps;
  dispose: () => Promise<void>;
}

/**
 * M31: builds one fully-wired project — DB, services, watchers, indexers and
 * the per-context router. Mechanical carve of the former startServer body;
 * handlers are byte-identical, only the mount prefixes lost their `/api`.
 * Await cost ≈ entityIndexer.indexAll() (<1s budget); section/todos/link
 * indexers stay fire-and-forget.
 */
/** Monotonic per-process counter making each ProjectContext's watch scope unique. */
let contextInstanceSeq = 0;
function nextContextInstance(): number {
  return ++contextInstanceSeq;
}

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
  const { registry, workspace, projectId, cwd, gateway, mode } = deps;
  const router = Router();
  const onContextConfigChanged = (): void => {
    deps.onContextConfigChanged?.();
  };
  // M31: every former WsGateway consumer now broadcasts into this project's
  // room only — the emitter is signature-compatible (`broadcast(event)`).
  const ws = new ProjectWsEmitter(gateway, projectId);
  // M31: per-project agent-turn registries (was module-global in agent-turn.ts).
  const activeAdapters = new Map<string, ActiveAdapter>();
  const pendingInputs = new Map<string, PendingInput>();

  const skillRegistry = SkillRegistry.load(findSkillsRoots(cwd));
  // 0.2.8: config migrations belong to project ACTIVATION, not to bootstrap
  // alone. `bootstrapProject` runs only for the CLI `--cwd` project and for
  // freshly added ones, so a workspace's other projects — opened here, from the
  // switcher — never saw a migration: the same workspace could hold one repaired
  // project and two carrying the shape that no longer loads. Idempotent, and it
  // writes only when something actually changed.
  migrateConfigToV4(cwd);
  const bootConfig = readConfig(cwd);
  // 0.1.96: page roots come from config.roots[]. The CLI --pages override
  // applies to the built-in 'pages' root's dir only.
  const effectiveRoots: Root[] = bootConfig.roots.map((r) =>
    r.id === 'pages' && deps.pagesDirOverride ? { ...r, dir: deps.pagesDirOverride } : r,
  );
  // M21: briefsDir, default '.claude4spec/briefs'. Must be relative, must not escape cwd.
  const briefsDir = bootConfig.briefsDir ?? '.claude4spec/briefs';
  resolveDirAbs(cwd, briefsDir, 'briefsDir');
  // M23: patchesDir, default '.claude4spec/patches'. Same validation as briefsDir.
  const patchesDir = bootConfig.patchesDir ?? '.claude4spec/patches';
  resolveDirAbs(cwd, patchesDir, 'patchesDir');
  // 0.1.127 M10/M36: plansDir, default '.claude4spec/plans'. Same validation as
  // briefsDir/patchesDir.
  const plansDir = bootConfig.plansDir ?? '.claude4spec/plans';
  resolveDirAbs(cwd, plansDir, 'plansDir');

  // M29: entitiesDir, default '.claude4spec/entities'. Same path-safety as
  // briefsDir/patchesDir — but this directory is COMMITTED to git (source of
  // truth for entities; SQLite is a derived index rebuilt from it at boot).
  const entitiesDir = bootConfig.entitiesDir ?? '.claude4spec/entities';
  const entitiesAbs = resolveDirAbs(cwd, entitiesDir, 'entitiesDir');

  // 0.1.118: releasesDir, default '.claude4spec/releases'. Same path-safety +
  // git-committed treatment as entitiesDir — source of truth for release
  // identity files; spec_release (SQLite) is a derived cache rebuilt from it.
  const releasesDir = bootConfig.releasesDir ?? '.claude4spec/releases';
  const releasesAbs = resolveDirAbs(cwd, releasesDir, 'releasesDir');

  // 0.1.96: cross-field root overlap validation. Hard errors abort the build
  // (mirrors the PATCH /api/config guard); soft warnings (vs briefs/patches) log.
  {
    const { errors, warnings, newPairConflicts } = validateRootDirs(effectiveRoots, { entitiesDir, releasesDir, briefsDir, patchesDir, plansDir });
    for (const w of warnings) console.warn(`[config] ${w}`);
    // 0.2.9: entitiesDir/releasesDir/plugins were never compared against each other
    // before, so an existing project may already violate the new pair rule. Refusing to
    // boot would strand it — the Settings screen that repairs config lives inside this
    // very context. Loud warning here, hard 400 on the next PATCH.
    for (const c of newPairConflicts) console.warn(`[config] ${c} — writes will collide; fix this in Settings → Directories`);
    if (errors.length > 0) throw new Error(errors[0]);
    // Artifact catalogs are distinct — an identical dir double-captures every
    // file into file_version under two markers. Warn (the PATCH route hard-400s).
    const artifactDirPairs: Array<[string, string, string, string]> = [
      ['briefsDir', briefsDir, 'patchesDir', patchesDir],
      ['briefsDir', briefsDir, 'plansDir', plansDir],
      ['patchesDir', patchesDir, 'plansDir', plansDir],
    ];
    for (const [aName, aDir, bName, bDir] of artifactDirPairs) {
      if (path.resolve(cwd, aDir) === path.resolve(cwd, bDir)) {
        console.warn(
          `[config] ${aName} === ${bName} ("${aDir}") — files will be double-indexed`,
        );
      }
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

  // M15 phase 2 / M37: fan plugin-contributed skills into this project's
  // SkillRegistry as `source: "plugin"` (precedence project > global > plugin >
  // bundled). Base (workspace/npm) skills always; project-local overlay skills
  // only on the trusted path (overlayResult is set only when trust === true),
  // so an untrusted plugin contributes no skill — exactly as for its entities.
  //
  // 0.2.19: a slug claimed by two plugins is a WARNING plus first-wins by
  // discovery order — never an abort. The loser's whole plugin keeps loading;
  // only that one skill is dropped. The warning is emitted here rather than in
  // the registry because this is the layer that knows which two plugins collided
  // and in what order they were discovered.
  for (const skill of [
    ...deps.pluginRegistry.listSkills(),
    ...(overlayResult?.skills ?? []),
  ]) {
    if (skillRegistry.hasPluginSkill(skill.slug)) {
      console.warn(
        `[skill] plugin skill slug "${skill.slug}" is contributed more than once; keeping the first by discovery order and skipping this one`,
      );
      continue;
    }
    skillRegistry.addPluginSkill(skill);
  }

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
  // A stale slug/value here (skill deleted, project opened on a machine
  // without it) must not deadlock the whole per-project build — that would
  // 500 every route under /api/projects/:id, including the Settings
  // endpoints the user would need to pick a valid value. Soft-fail instead,
  // matching the runtime pattern in SkillResolver.resolve(): warn and treat
  // the value as unavailable for this session. config.json is left untouched
  // so a later `git pull`/restore just works again with no further action.
  let initialWritingStyle = bootConfig.writingStyle;
  if (initialWritingStyle !== null && !skillRegistry.isSelectable(initialWritingStyle)) {
    console.warn(
      `config.json: writingStyle "${initialWritingStyle}" ${skillRegistry.unselectableReason(initialWritingStyle)}`,
    );
    initialWritingStyle = null;
  }
  // 0.1.51: fail fast on a hand-edited language value outside SUPPORTED_LANGUAGES so
  // a bogus display name never reaches the system prompt. PATCH /config enforces
  // the same membership at runtime.
  if (bootConfig.language !== null && !isSupportedLanguage(bootConfig.language)) {
    console.warn(
      `config.json: language "${bootConfig.language}" not supported. Available: ${SUPPORTED_LANGUAGES.join(', ')}`,
    );
  }
  const initialConvLang = bootConfig.agent?.conversationalLanguage ?? null;
  if (initialConvLang !== null && !isSupportedLanguage(initialConvLang)) {
    console.warn(
      `config.json: agent.conversationalLanguage "${initialConvLang}" not supported. Available: ${SUPPORTED_LANGUAGES.join(', ')}`,
    );
  }
  const skillResolver = new SkillResolver(skillRegistry, cwd);

  const db: Db = openDb(workspace, projectId);
  cleanup.push(() => db.close());
  const dbSlotDir = registry.slotDir(workspace, projectId);

  // ── M40 phase A: MOUNTS ────────────────────────────────────────────────────
  // Mount → subscribe is a contract, not a preference: `subscribe` to an
  // unmounted source throws, so every directory owner claims its source here and
  // every subscription is registered further down, after the services exist.
  // Scope is this context: dispose unmounts exactly these, and leaves
  // `scope: 'process'` mounts (the base plugin pool) alone.
  // Scope is per CONTEXT INSTANCE, not per project. A retired-but-not-yet-disposed
  // context (one with an in-flight turn) still owns its mounts, so keying on the
  // projectId alone made the replacement collide with it on `mountSource` — the
  // rebuild threw, and its cleanup then unmounted the LIVE context's watchers.
  // The instance suffix is stripped when routing WS, so the room is still the project.
  const watchScope: WatchScope = `context:${projectId}#${nextContextInstance()}`;
  const w = deps.watchRuntime.scoped(watchScope);
  cleanup.push(() => w.dispose());

  // 0.1.96: one runtime (PagesService + StaticHtmlService + FileSerializer) per
  // configured page root, plus a `pages:<rootId>` mount. The built-in 'pages'
  // root is always present; user roots are additive. Every per-directory
  // behaviour is gated on the root's PROPERTIES below, never on `root.id === 'pages'`.
  interface RootRuntime {
    root: Root;
    pages: PagesService;
    staticHtml: StaticHtmlService;
    source: string;
    writer: SelfWriteMarker;
    serializer: FileSerializer;
  }
  const rootRuntimes: RootRuntime[] = [];
  for (const root of effectiveRoots) {
    const pagesSvc = new PagesService(cwd, root.dir, root.id);
    await pagesSvc.ensureRoot();
    const staticSvc = new StaticHtmlService(cwd, root.dir);
    const source = pageSource(root.id);
    w.mountSource({ source, dir: pagesSvc.root });
    rootRuntimes.push({
      root,
      pages: pagesSvc,
      staticHtml: staticSvc,
      source,
      writer: boundWriter(w, source),
      serializer: new FileSerializer(pagesSvc),
    });
  }
  const rootById = new Map(rootRuntimes.map((rt) => [rt.root.id, rt]));
  // The built-in 'pages' runtime backs the many single-root consumers that still
  // take one PagesService/FileSerializer (release restore, entity reference-tools,
  // current-page fetch, etc.).
  const pagesRuntime = rootById.get('pages')!;
  const pages = pagesRuntime.pages;
  const pagesWriter = pagesRuntime.writer;
  const pageSerializer = pagesRuntime.serializer;

  // M36: artifact mounts — one {PagesService, M40 mount, FileSerializer} per
  // `artifactRegistry` entry (brief/patch today; a follow-up brief adds 'plan').
  // Briefs & patches are NOT roots — `Root`'s releasable/referenceValidated/
  // linkTargets/sidebar/briefTarget flags have no meaning for artifacts — so
  // this stays a separate map (`artifactMounts`), never folded into
  // `rootRuntimes`/`rootById`. Resolving each entry's directory through this
  // lookup (rather than a hardcoded per-kind branch) is what lets a future
  // `plan` entry be "add one key to `artifactDirs` + one registry entry",
  // not a rewrite of this loop.
  interface ArtifactMount {
    entry: ArtifactRegistryEntry;
    pages: PagesService;
    source: string;
    writer: SelfWriteMarker;
    serializer: FileSerializer;
  }
  const artifactDirs: Record<ArtifactRegistryEntry['dirConfigKey'], string> = {
    briefsDir,
    patchesDir,
    plansDir,
  };
  const artifactMounts = new Map<ArtifactKind, ArtifactMount>();
  await Promise.all(
    Object.values(artifactRegistry).map(async (entry) => {
      const mountPages = new PagesService(cwd, artifactDirs[entry.dirConfigKey], entry.rootId);
      await mountPages.ensureRoot();
      const source = artifactSource(entry.kind);
      w.mountSource({ source, dir: mountPages.root });
      artifactMounts.set(entry.kind, {
        entry,
        pages: mountPages,
        source,
        writer: boundWriter(w, source),
        serializer: new FileSerializer(mountPages),
      });
    }),
  );
  const briefsMount = artifactMounts.get('brief')!;
  const patchesMount = artifactMounts.get('patch')!;
  const plansMount = artifactMounts.get('plan')!;
  // 0.1.127: one-time boot cutover of legacy SQLite plan rows to
  // `plansDir/*.md` — must run before the M36 initial-sync IIFE below (~line
  // 962) so its file_version capture picks up these files, and before
  // PlanService is constructed since it reads exclusively through plansMount now.
  await backfillPlansToFilesystem({
    db: db.handle,
    plansPages: plansMount.pages,
    backupDb: () => backupDbBeforeMigration(dbSlotDir),
  });

  const tagsService = new TagsService(db.handle);
  tagsService.setHost(pluginHost);
  const versionService = new VersionService(db.handle);
  const rawReader = new RawEntityReader(db.handle, pluginHost);
  // 2.0.0: give the host the index too, so `entityExists` can answer for a type
  // that declares its data and registers no service.
  pluginHost.setRawReader(rawReader);
  // M17: wire snapshot capture deps. After this, every entity service
  // mutation captures a deterministic snapshot via host.snapshot(...).
  versionService.configureSnapshot(rawReader, pluginHost);
  // M24: remote-account identity (device flow + local session). Single HTTP
  // client per project context; base URL from config.remoteApiUrl (or the prod constant).
  const remoteHttpClient = new RemoteHttpClient(remoteApiUrl);
  const remoteAuthService = new RemoteAuthService(db.handle, remoteHttpClient);
  // `activeAdapters` (wyzej w tym pliku) jest jedynym zrodlem prawdy dla trzech rzeczy:
  // istnienia bufora replay, kodu odpowiedzi live-join (200 vs 404) i pola `isLive` na DTO.
  const chatService = new ChatService(db.handle, (threadId) => activeAdapters.has(threadId));
  // M05 0.1.62: user's own ANTHROPIC API key (single-row, encrypted at-rest).
  const agentCredentialService = new AgentCredentialService(db.handle);
  // Orphan cleanup: rowsy chat_message.status='streaming' pozostale po crashu poprzedniego
  // procesu (SIGKILL/OOM) — brak aktywnego adaptera po starcie, flipujemy wszystkie na 'complete'.
  chatService.finalizeAllStreamingRows();
  // 0.2.50: same reasoning one table over. A background task whose process died
  // with the previous server will never send `background_task_completed`, so
  // without this sweep its row would render as still-running forever.
  chatService.finalizeAllRunningBackgroundTasks();

  // M33 phase 3: the project-local plugin overlay (axis B — pool composition).
  // The trust gate blocks the MOUNT, not just the subscription: without consent
  // the source does not exist at all, so an untrusted repo can never reload
  // project-committed plugin code. (Contrast `sectionIndexed`, which gates only
  // whether M02 registers M06's subscription on an always-mounted source.)
  const overlayMounted = trust === true;
  if (overlayMounted) w.mountSource({ source: PLUGINS_OVERLAY_SOURCE, dir: projectPluginsDir(cwd) });
  const overlayVersionByPkg = new Map(
    overlayRecords.filter((r) => r.manifestVersion).map((r) => [r.package, r.manifestVersion!]),
  );
  const entityStore = new EntityStore(cwd, entitiesDir, boundSuppress(w, ENTITIES_SOURCE), rawReader, pluginHost);
  entityStore.ensureRoot();
  // M29: mount only AFTER `ensureRoot()` — chokidar silently swallows ENOENT on a
  // missing directory and never picks it up later, so mounting first left a fresh
  // project with entity edits that were never reindexed for the whole life of the
  // context. (The page and artifact mounts above already await `ensureRoot()`.)
  w.mountSource({ source: ENTITIES_SOURCE, dir: entitiesAbs });
  // M34/L11: wire version-restore deps now that entityStore exists.
  versionService.configureRestore(entityStore, tagsService);
  const entityIndexer = new EntityIndexerService(
    db.handle,
    entityStore,
    boundSuppress(w, ENTITIES_SOURCE),
    ws,
    pluginHost,
    tagsService,
    rawReader,
  );
  // 0.1.118: sibling triad for the on-disk release-identity store — mirrors
  // the entities triad above exactly (its own mount, atomic file store,
  // upsert-by-slug indexer keeping spec_release.id stable — see
  // ReleaseIndexerService's header comment for why it must NOT delete-all).
  const releaseFileStore = new ReleaseFileStore(cwd, releasesDir, boundSuppress(w, RELEASES_SOURCE));
  releaseFileStore.ensureRoot();
  w.mountSource({ source: RELEASES_SOURCE, dir: releasesAbs });
  const releaseIndexer = new ReleaseIndexerService(db.handle, releaseFileStore, boundSuppress(w, RELEASES_SOURCE));
  // 0.1.96: per-behaviour root maps (gated on root PROPERTIES, not id).
  const sectionIndexedRoots = new Map<string, SectionIndexRoot>();
  const referenceValidatedServices = new Map<string, PagesService>();
  const referenceValidatedWriters = new Map<string, SelfWriteMarker>();
  const sidebarRoots = new Map<string, PagesService>(); // todos: any root with a visible tree
  const allRootServices = new Map<string, PagesService>();
  for (const rt of rootRuntimes) {
    allRootServices.set(rt.root.id, rt.pages);
    if (rt.root.sectionIndexed) sectionIndexedRoots.set(rt.root.id, { pages: rt.pages });
    if (rt.root.referenceValidated) {
      referenceValidatedServices.set(rt.root.id, rt.pages);
      referenceValidatedWriters.set(rt.root.id, rt.writer);
    }
    if (rt.root.sidebar !== 'hidden') sidebarRoots.set(rt.root.id, rt.pages);
  }

  const referencesService = new ReferencesService(referenceValidatedServices, referenceValidatedWriters);
  const sectionsService = new SectionsService(db.handle);
  // SectionsService rewrites `<section_ref/>` anchors across every section-indexed
  // root, so it needs each root's write handle as well as its PagesService.
  sectionsService.setWriteDeps(
    new Map(
      [...sectionIndexedRoots.keys()].map((rootId) => [
        rootId,
        { pages: rootById.get(rootId)!.pages, watcher: rootById.get(rootId)!.writer },
      ]),
    ),
  );

  const sectionIndexer = new SectionIndexerService(db.handle, sectionIndexedRoots, ws, pluginHost);
  const todosIndexer = new TodosIndexerService(sidebarRoots, ws);
  // pages-link indexer covers every page root (autocomplete/meta), resolving links
  // within each root (self-scope); cross-root @-scope is applied client-side.
  const pagesLinkIndexer = new PagesLinkIndexerService(allRootServices, ws);
  // M17: page versioning — shared instance; per-root serializer + rootId passed per recordVersion.
  const pageVersions = new FileVersionService(db.handle, pageSerializer);
  // M36: in-memory frontmatter indexer over every page root + the artifact mounts.
  const frontmatterRoots = new Map<string, PagesService>(allRootServices);
  for (const m of artifactMounts.values()) frontmatterRoots.set(m.entry.rootId, m.pages);
  // rootId -> WS event kind, derived from the registry (replaces a hardcoded
  // per-kind if/else inside PagesFrontmatterIndexer.broadcastRootChange).
  const artifactChangedEvents = new Map(
    Object.values(artifactRegistry).map((e) => [e.rootId, e.changedEvent] as const),
  );
  const pagesFrontmatterIndexer = new PagesFrontmatterIndexer(frontmatterRoots, ws, artifactChangedEvents);

  /**
   * Host API 2.0.0 — build the entity projection BEFORE anything mounts, reads
   * or upserts, and before `entityIndexer.indexAll()` further down.
   *
   * Over every AVAILABLE module, not just the active ones. The schema is a
   * function of what is INSTALLED, not of what is enabled: a deactivated type
   * keeps its (empty) table, which is what stops `GET /entities/counts` from
   * 500-ing the whole sidebar over one missing table. That property used to be
   * maintained by a two-pass migration loop in `mountBackend`; it is now one
   * idempotent call whose input is the same declaration the rest of the host
   * reads.
   */
  const projection = applyProjection(db.handle, pluginHost.listAvailable());
  if (projection.created.length || projection.alteredColumns.length) {
    console.log(
      `[projection] created ${projection.created.join(', ') || '—'}` +
        (projection.alteredColumns.length ? `; added ${projection.alteredColumns.join(', ')}` : ''),
    );
  }

  /**
   * 2.0.0 (A.8) — the declarative write door, built BEFORE `mountBackend` so a
   * plugin's own route can use the same one `/api/{type}s` does.
   *
   * Every ingredient already exists by here; only `discovery` (constructed
   * further down for the generated router's READ path) does not, and the write
   * functions never touch it. The generated-router deps below extend this object
   * rather than rebuild it, so the two cannot drift apart.
   */
  const crudDeps = {
    host: pluginHost,
    reader: rawReader,
    tags: tagsService,
    store: entityStore,
    references: referencesService,
    projection: { db: db.handle, store: entityStore, versions: versionService },
  };

  /**
   * The three write verbs, bound to `crudDeps` — and doing everything the
   * generated router does around them, which is the whole claim `CrudFacade`
   * makes ("the SAME write door `/api/{type}s` goes through").
   *
   * The first cut was three bare `generic*` calls, and that claim was false in
   * two ways. `propagateRename` was missing, so a plugin renaming an entity
   * through the facade moved the row and the file while leaving every
   * `<inline_mention/>` and every `ref`-flagged field pointing at the old slug —
   * the exact fan-out `PATCH /api/{type}s/:slug` performs. And the
   * `entity:changed` broadcast was missing, so no open client saw the write.
   *
   * Async because `propagateRename` is: a plugin awaiting a write it has to
   * await is the correct contract, and fire-and-forget here would reintroduce
   * the same silence one layer down.
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

  // Mount all active backend modules — each plugin constructs its own domain
  // helper, mounts its router, registers its MCP server, and registers that
  // helper via the supplied MountContext. Inactive plugins are skipped
  // (config.entities).
  /**
   * Assigned right after `createDiscoveryCore` below. The core is built OVER the
   * plugin registry, and mounting is what fills the registry — so the mount
   * cannot be handed a finished core, only a way to reach one later.
   */
  let discoveryCore: DiscoveryCore | null = null;

  pluginHost.mountBackend({
    app: router,
    reader: rawReader,
    crud: crudFacade,
    host: pluginHost,
    discovery: () => {
      if (!discoveryCore) {
        throw new Error('discovery core requested during mount — it does not exist until mounting finishes');
      }
      return discoveryCore;
    },
    cwd,
    roots: effectiveRoots,
    ws,
    tagsService,
    versionService,
    referencesService,
    entityStore,
    registerMcpServer: (name, server) => pluginHost.registerMcpServer(name, server),
    registerEntityService: (type, service) => pluginHost.registerEntityService(type, service),
    registerRenameListener: (fn) => pluginHost.registerRenameListener(fn),
  });

  /**
   * 2.0.0 (A.8) — rename propagation, registered from the declaration rather
   * than from each type's synthesized `mount`. One listener per module whose
   * schema carries a `ref` flag, over every registered module — including ones
   * that write `mount` by hand, which previously needed a composed closure to
   * get the same behaviour. Runs after `mountBackend` so a module's own listener
   * (if it registered one) still sees the event first.
   */
  registerRefRewriteListeners(pluginHost, db.handle, entityStore);

  // Cross-cutting MCP server — owned by the host, not a plugin (M13).
  // Registered as a factory: a fresh instance is built per `adapter.execute()` so
  // neither concurrent turns nor successive queries of one turn share an MCP
  // transport. See `registerMcpServer` in plugin-host/types.ts for why the unit is
  // the query rather than the turn.
  pluginHost.registerMcpServer('reference-tools', () =>
    createReferenceToolsServer({
      pluginHost,
      tagsService,
      referencesService,
      discovery,
      ws,
      entityStore,
    }),
  );

  /**
   * 0.2.13 item 28 — the page write path, owned by the host like reference-tools.
   *
   * Registered HERE rather than wired into the two channels by hand, and that is
   * the whole trick: `buildMcpServers()` is what both `routes/agent-turn.ts` and
   * `mcp/surface.ts` already read, so one registration reaches the internal turn
   * and the external MCP mount with no edit to either. The gating then falls out
   * of machinery that already exists — all four operations declare
   * `opClass: 'write'`, so `gateServer` withholds them from `ask` and drops this
   * server once it is left empty, while `brief`'s release-only plugin pool never
   * offers it at all.
   *
   * `rootById` is captured rather than re-derived: the same map the REST router
   * resolves through, so a root reachable from one channel is reachable from the
   * other by construction.
   */
  const sectionWriteDeps: SectionWriteDeps = {
    sections: sectionsService,
    resolveRoot: (rootId) => {
      const rt = rootById.get(rootId);
      return rt ? { pages: rt.pages, writer: rt.writer, versions: pageVersions } : undefined;
    },
    /**
     * 0.2.17 — the anchor-loss guard's one dependency.
     *
     * `discovery` is declared BELOW this object, and that is safe rather than
     * lucky: the closure is only ever called during a page write, long after the
     * const is initialised. Hoisting the core above here to avoid the shape of
     * the problem would reorder a block whose current order carries its own
     * reasons.
     *
     * `findReferencesAll` rather than one `findReferences` page: the core
     * paginates, and a guard that read only the first page would let a write
     * through for having too many referents to fit.
     */
    findSectionReferents: async (anchor) =>
      (await findReferencesAll(discovery, { target: 'section', anchor })).map((hit) => ({
        page: hit.pagePath,
        ...(hit.anchor !== undefined ? { anchor: hit.anchor } : {}),
      })),
  };
  pluginHost.registerMcpServer('page-tools', () =>
    createPageToolsServer({
      ...sectionWriteDeps,
      rootIds: () => [...rootById.keys()],
      isSectionIndexed: (rootId) => rootById.get(rootId)?.root.sectionIndexed ?? true,
    }),
  );

  // M13: generic write-side CRUD server for every active entity type — the
  // single `entity-tools` server replacing the per-type CRUD servers. Owned by
  // the host (like reference-tools/release-tools), not a plugin: registered
  // exactly once per ProjectContext. Hoisted here (rather than at its prior
  // construction site near the return statement) so both this registration and
  // the final `serialization:` field below share one SerializationEngine.
  const serializationEngine = new SerializationEngine(pluginHost);
  /**
   * M39: one discovery core per project context, shared by every in-process
   * tool server. The built-in chat agent reaching the spec through the same
   * operations the CLI and the external MCP server use is the whole point —
   * the asymmetry where the internal agent read the filesystem while external
   * agents got bounded operations was a fourth, undocumented transport.
   */
  const discovery = createDiscoveryCore({
    reader: rawReader,
    db: db.handle,
    host: pluginHost,
    serialization: serializationEngine,
    roots: effectiveRoots,
    projectDir: cwd,
    packageVersion: readPackageVersion(),
  });
  discoveryCore = discovery;
  /**
   * 0.2.13 (tier C) — the same core over a NARROWED root list, for `?pages=`.
   *
   * The CLI used to build this itself: `--pages <dir>` was applied while
   * `src/bin/c4s/context.ts` assembled its own discovery core. With execution
   * moved into the server process the override has to be applied where the roots
   * are assembled, which is here.
   *
   * Cheap enough to do per request. `createDiscoveryCore` is a factory over
   * pieces that already exist — the reader, the db handle, the plugin host, the
   * serialization engine are all shared with the project's own core; only the
   * root list differs. Nothing is loaded, migrated or indexed by this call.
   */
  const discoveryForRoots = (pagesOverride: string): DiscoveryCore =>
    createDiscoveryCore({
      reader: rawReader,
      db: db.handle,
      host: pluginHost,
      serialization: serializationEngine,
      roots: applyPagesOverride(effectiveRoots, pagesOverride, cwd),
      projectDir: cwd,
      packageVersion: readPackageVersion(),
    });
  pluginHost.registerMcpServer('entity-tools', () =>
    createEntityToolsServer({
      host: pluginHost,
      reader: rawReader,
      discovery,
      db: db.handle,
      ws,
      referencesService,
      // 2.0.0 (item 28): the generic write door for a type with no service.
      tagsService,
      entityStore,
      versionService,
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
    (rootId) => rootById.get(rootId)?.writer ?? null,
    cwd,
    releasableRootIds,
    releasableRootDirs,
  );
  // M29: release restore must persist restored entities' files.
  releaseService.setEntityStore(entityStore);
  // 0.1.118: release create/update writes the on-disk identity file.
  releaseService.setReleaseStore(releaseFileStore);
  // M28 Git Sync — best-effort mirroring of release create/push into the user's
  // git repo. Probes the releasable roots for a worktree; reads config per-action.
  // 0.1.123: `checkout()` hard-blocks while a turn is live, so it shares the
  // same `activeAdapters` predicate as `ProjectContext.hasInFlightTurn` below.
  const gitService = new GitService(cwd, releasableRootDirs, () => activeAdapters.size > 0);
  // 0.1.118: needed for the git-anchored getReleaseDiff branch.
  releaseService.setGitService(gitService);
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
    const importService = new ReleaseImportService(
      db.handle,
      releaseService,
      remoteHttpClient,
      cwd,
      skillRegistry,
    );
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
    cwd,
    briefsPages: briefsMount.pages,
    briefsWatcher: briefsMount.writer,
    briefsSerializer: briefsMount.serializer,
    pageVersions,
    chatService,
    releaseService,
    frontmatterIndexer: pagesFrontmatterIndexer,
    ws,
  });

  // M23: PatchService — top-level (nie plugin), wzorzec analogiczny do
  // BriefService. Mountowany router /patches poniżej.
  const patchService = new PatchService({
    patchesPages: patchesMount.pages,
    patchesWatcher: patchesMount.writer,
    patchesSerializer: patchesMount.serializer,
    pageVersions,
    chatService,
    frontmatterIndexer: pagesFrontmatterIndexer,
  });

  // 0.1.127 M10: PlanService — filesystem-backed as of the plan -> file
  // migration (brief 0-1-126-to-0-1-127), same top-level/consumer-slice
  // pattern as BriefService/PatchService above.
  const planService = new PlanService({
    plansPages: plansMount.pages,
    plansWatcher: plansMount.writer,
    plansSerializer: plansMount.serializer,
    pageVersions,
    chatService,
    frontmatterIndexer: pagesFrontmatterIndexer,
    ws,
  });

  // Per-context config/meta/writing-styles (carved out of startServer inline
  // handlers — single response builder in routes/config.ts).
  router.use(
    configRouter({
      cwd,
      skillRegistry,
      onContextConfigChanged,
      // Validate overlaps against the roots THIS context runs on (`--pages` applied),
      // so the route cannot accept a dir the next boot would reject.
      effectiveRoots,
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
      onContextConfigChanged,
    }),
  );
  // 0.1.96: pages/static routers resolve a per-root runtime from the `:rootId`
  // segment; unknown id → 404 ROOT_NOT_FOUND.
  const resolveRoot = (rootId: string): PageRootRuntime | undefined => {
    const rt = rootById.get(rootId);
    return rt ? { root: rt.root, pages: rt.pages, writer: rt.writer, versions: pageVersions } : undefined;
  };
  const resolveStatic = (rootId: string): StaticHtmlService | undefined => rootById.get(rootId)?.staticHtml;
  /**
   * 0.2.13 — the `rest` rendering of four M39 core operations (`overview`,
   * `describe_types`, `resolve_identity`, `check_consistency`). Shares the
   * `/_meta` prefix with `pluginHostRouter` above, which owns activation and
   * plugin diagnostics; the paths are disjoint, so both mount.
   */
  router.use('/_meta', metaRouter(discovery, pluginHost));
  /**
   * 0.2.13 — `POST /api/patches`. A slice-specific route, deliberately outside
   * the generic `/api/artifacts/:kind/*` family: a patch's provenance is DRIFT
   * AGAINST A BRIEF, so the route takes the intention (which brief, what class of
   * deviation, what drifted) rather than a finished file. The server writes the
   * file; the caller never composes one.
   *
   * This is the hard prerequisite for taking `fs-scoped` away from
   * `c4s file-patch` — until there was a route, the CLI had to write the file in
   * its own process, which is the last reason it needed a filesystem handle to
   * the specification.
   */
  const patchWriteDeps = {
    briefsDirAbs: path.resolve(cwd, briefsDir),
    patchesDirAbs: path.resolve(cwd, patchesDir),
  };
  router.use('/patches', patchesRouter(patchWriteDeps));
  /**
   * 0.2.13 (tier C) — `search_pages` is project-scoped (`rootId` only NARROWS
   * it), so it mounts at `/pages` with no root segment. **Order is the
   * contract**: registered before `/pages/:rootId`, or `search` is captured as a
   * root id and the operation answers `ROOT_NOT_FOUND`.
   */
  router.use('/pages', crossRootPagesRouter(discovery));
  router.use(
    '/pages/:rootId',
    pagesRouter(resolveRoot, pageVersions, discovery, () => [...rootById.keys()], sectionWriteDeps),
  );
  router.use('/static/:rootId', staticRouter(resolveStatic));
  router.use('/tags', tagsRouter(tagsService, referencesService, discovery));
  router.use('/references', referencesRouter(pluginHost, referencesService, discovery, discoveryForRoots));
  router.use('/entities', entitiesRouter(pluginHost, tagsService, versionService, entityStore, rawReader, discovery));

  /**
   * Host API 2.0.0 (item 31) — `/api/{type}s` for every type that declares its
   * data, generated from that declaration.
   *
   * Mounted HERE and not in `synthesizeMount` for one reason: it reads through
   * the M39 core, and `rawReader`/`discovery` do not exist yet at
   * `mountBackend` time.
   *
   * Tier K deleted the six per-type routers, so every built-in type lands here.
   * The two `endpoint` relation routes that remain are mounted ahead of this one
   * (registration order) and are not CRUD verbs, so they do not shadow anything.
   */
  const genericCrudDeps = { ...crudDeps, discovery, ws };
  for (const module of pluginHost.listEntities()) {
    if (!module.data?.schema) continue;
    router.use(module.pathPrefix, generatedCrudRouter(genericCrudDeps, module));
  }
  router.use('/external-skills', externalSkillsRouter({ registry, workspace, projectId }));
  // 0.1.58: peer-discovery for the `<workspace_projects>` prompt block. For each
  // workspace project except this one, build a PeerProject. Re-read per turn so
  // peer-config edits surface on the next thread's first turn.
  //
  // 0.2.50 — TWO names, and the distinction is load-bearing rather than
  // cosmetic. `displayName`/`description` come from the peer's own config.json
  // (source of truth, no denormalization) and are what a human calls the
  // project: "C4S - App Spec". `registryName` is `ProjectRecord.name` from
  // `~/.claude4spec/workspaces.json`, and it is the only one of the two that
  // `ask({ project })` can resolve — `resolveWorkspaceProject` falls back to
  // `findProjectByName`, which compares against the REGISTRY name exactly. The
  // prompt used to render the display name beside the path; drop the path and
  // keep the display name alone, and peer consultation breaks with
  // PROJECT_SLUG_NOT_FOUND. Unreadable config → registry name and path only.
  const listWorkspacePeers = (): PeerProject[] => {
    const ws = registry.getWorkspace(workspace.name);
    if (!ws) return [];
    return ws.projects
      .filter((p) => p.cwd !== cwd)
      .map((p) => {
        const peer: PeerProject = { path: p.cwd, registryName: p.name };
        try {
          const peerCfg = readConfig(p.cwd);
          if (peerCfg.name) peer.name = peerCfg.name;
          if (peerCfg.description) peer.description = peerCfg.description;
        } catch {
          /* unreadable/missing config → no display name, not an error */
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
    // Resolve a page-root's service by id so the chat "current page" context is read
    // from the root the user is actually viewing (not always the built-in `pages`).
    resolvePagesService: (rootId: string) => allRootServices.get(rootId),
    tagsService,
    sectionsService,
    planService,
    briefService,
    patchService,
    // M23: `file_patch` over MCP resolves the same two directories the REST
    // route does — one operation, one pair of paths, both channels.
    patchWrite: patchWriteDeps,
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
    /**
     * 0.2.13 — M31's `list_projects`, rendered into the tool channel by
     * `workspace-tools`. Re-reads the registry per call rather than closing over
     * a snapshot: the whole reason this operation exists is that the
     * `<workspace_projects>` prompt block is rendered once per thread and goes
     * stale, and a captured record would have gone stale the same way.
     */
    listWorkspaceProjects: () => listProjects(registry.getWorkspace(workspace.name) ?? workspace),
  };

  /**
   * 0.2.13: the same services, handed to the EXTERNAL channel.
   *
   * Deliberately built from the identical locals `agentDeps` closes over — one
   * discovery core, one plugin host, one brief service. The whole point of the
   * release is that an external caller and the built-in agent reach the same
   * operations; two dependency sets here would have re-created the drift by
   * construction.
   */
  const mcpSurfaceDeps = (profile: ChatContextType): ExternalSurfaceDeps => ({
    profile,
    reader: {
      reader: rawReader,
      discovery,
      db: db.handle,
      projectDir: cwd,
      packageVersion: readPackageVersion(),
    },
    pluginHost,
    planService,
    pageVersions,
    briefService,
    patchWrite: patchWriteDeps,
    listProjects: agentDeps.listWorkspaceProjects,
    workspaceName: workspace.name,
  });
  // `project-bound`: the project parameter's default comes from the URL this
  // router is already mounted under. See `routes/mcp.ts`.
  router.use('/mcp', projectMcpRouter(readPackageVersion(), projectId, mcpSurfaceDeps));
  router.use('/threads', threadsRouter(agentDeps));
  router.use('/sections', sectionsRouter(sectionsService, discovery, sectionWriteDeps));
  router.use('/todos', todosRouter(todosIndexer));
  router.use('/page-links', pageLinksRouter(pagesLinkIndexer));
  router.use('/plans', plansRouter(planService));
  router.use('/releases', releasesRouter(releaseService, ws, gitService));
  router.use('/release-pushes', releasePushesRouter(releasePushService));
  // 0.1.123: on a successful checkout, reuse the same invalidate path as a
  // context-defining config change — no new M31 reload machinery needed.
  router.use('/git', gitRouter(gitService, { onSwitched: onContextConfigChanged }));
  router.use('/briefs', briefsRouter(briefService));
  router.use(
    '/artifacts',
    artifactsRouter({
      brief: briefService,
      patch: patchService,
      plan: planService,
      pageVersions,
      chat: chatService,
    }),
  );
  router.use('/agent', agentRouter(agentCredentialService));
  router.use('/remote-account', remoteAccountRouter(remoteAuthService));
  router.use('/remote-project', remoteProjectRouter(remoteAuthService, cwd));
  router.use('/chat', chatRouter(agentDeps));
  router.use(errorHandler);

  // ── M40 phase B: SUBSCRIPTIONS ────────────────────────────────────────────
  // Every mount above is claimed; now each module registers its reactions with a
  // declared phase and, where it matters, an `after`. Order is enforced by the
  // runtime at dispatch time, not by the order of these lines. There are no
  // wildcards on `source`, so a subscriber of many sources iterates them here
  // explicitly.
  const captureSerializers = new Map<string, FileSerializer>();
  for (const rt of rootRuntimes) captureSerializers.set(rt.root.id, rt.serializer);
  for (const m of artifactMounts.values()) captureSerializers.set(m.entry.rootId, m.serializer);
  const versionCapture = new FileVersionCapture(pageVersions, captureSerializers, (scope, source, relPath) =>
    deps.watchRuntime.peekActor(scope, source, relPath),
  );
  const anchorInjection = sectionIndexer.anchorInjectionSubscriber((source, relPath) => w.suppress(source, relPath));

  // M06 anchor injection for plan files written OUTSIDE `PlanService.update`
  // (an agent or user editing `plansDir` directly). `PlanService.update` runs the
  // same `injectAnchors` synchronously, because `insert_after_section` must see
  // the anchors with no debounce window in between.
  const planAnchorInjection: WatchSubscriber = {
    onChange: async (_scope, source, relPath) => {
      const mount = artifactMounts.get('plan')!;
      let page;
      try {
        page = await mount.pages.read(relPath);
      } catch {
        return; // already gone — skip idempotently
      }
      const injected = injectAnchors(page.body);
      if (injected === page.body) return;
      w.suppress(source, relPath);
      await mount.pages.write(relPath, { frontmatter: page.frontmatter, body: injected });
    },
    onUnlink: () => {},
  };

  for (const rt of rootRuntimes) {
    const source = rt.source;

    // M02 — frontmatter projection + the `file:changed` notification it owns.
    w.subscribe(source, pagesFrontmatterIndexer, {
      id: 'm02-frontmatter-indexer',
      phase: 'projection',
      filter: MARKDOWN_FILTER,
    });
    w.subscribe(source, pageChangedNotifier(ws), {
      id: 'm02-file-changed',
      phase: 'notification',
      filter: MARKDOWN_FILTER,
    });

    // M06 — the gate decides whether the SUBSCRIPTION exists; the source is
    // mounted for every root regardless. That is why M14's `after` below can go
    // unsatisfied on a non-indexed root without being a registration race.
    if (rt.root.sectionIndexed) {
      w.subscribe(source, sectionIndexer, {
        id: 'm06-section-indexer',
        phase: 'projection',
        filter: MARKDOWN_FILTER,
      });
      w.subscribe(source, anchorInjection, {
        id: 'm06-anchor-injection',
        phase: 'write-back',
        filter: MARKDOWN_FILTER,
      });
    }

    // M08 — todos, on any root with a visible tree. Read-only; never suppresses.
    if (rt.root.sidebar !== 'hidden') {
      w.subscribe(source, todosIndexer, { id: 'm08-todos-indexer', phase: 'projection', filter: MARKDOWN_FILTER });
    }

    // M14 — link index. Must not run before M06 has minted anchors on a root
    // where M06 runs at all; where it does not, this dependency is simply
    // unsatisfied and M14 runs alone (leaving `@page.md#anchor` unresolved,
    // which is a signal to the author rather than silence).
    w.subscribe(source, pagesLinkIndexer, {
      id: 'm14-link-indexer',
      phase: 'projection',
      after: ['m06-section-indexer'],
      filter: MARKDOWN_FILTER,
    });

    // M30 — `.html` preview refresh. The filter is the whole reaction: html files
    // get no anchors, no references and no versions.
    w.subscribe(source, htmlPreviewNotifier(ws), {
      id: 'm30-html-preview',
      phase: 'notification',
      filter: HTML_FILTER,
    });

    // M17 — capture, after every write-back, so the version contains the anchors.
    w.subscribe(source, versionCapture, {
      id: 'm17-capture',
      phase: 'capture',
      after: ['write-back'],
      filter: MARKDOWN_FILTER,
    });
  }

  // M36: artifact sources get the frontmatter projection, their own owner's
  // notification, and capture — but NEVER section/todos/link indexing. Briefs and
  // patches are not pages in the M02 sense: not part of the navigable tree, and
  // they do not aggregate section_ref/todos into tables. `sectionIndexed: false`
  // on every registry entry formalizes this.
  for (const m of artifactMounts.values()) {
    const source = m.source;
    w.subscribe(source, pagesFrontmatterIndexer, {
      id: 'm02-frontmatter-indexer',
      phase: 'projection',
      filter: MARKDOWN_FILTER,
    });
    const notifier = artifactChangedNotifier(ws, m.entry.kind);
    if (notifier) {
      w.subscribe(source, notifier, {
        id: `m36-${m.entry.kind}-changed`,
        phase: 'notification',
        filter: MARKDOWN_FILTER,
      });
    }
    // Plans are the one artifact kind with `anchorInjection: true` — the same
    // implementation `PlanService.update` runs synchronously, registered here for
    // writes that bypass the service entirely (an agent or user editing the file
    // on disk).
    if (m.entry.kind === 'plan') {
      w.subscribe(source, planAnchorInjection, {
        id: 'm06-plan-anchor-injection',
        phase: 'write-back',
        filter: MARKDOWN_FILTER,
      });
    }
    w.subscribe(source, versionCapture, {
      id: 'm17-capture',
      phase: 'capture',
      after: ['write-back'],
      filter: MARKDOWN_FILTER,
    });
  }

  // M29: external edits / git pull of entity files → incremental reindex. This
  // projection blocks project readiness (see the awaited `indexAll()` below).
  w.subscribe(ENTITIES_SOURCE, entityIndexer, {
    id: 'm29-entity-indexer',
    phase: 'projection',
    filter: JSON_FILTER,
  });
  // 0.1.118: same for release-identity files — upsert-by-slug, never delete-all
  // (see ReleaseIndexerService's header comment).
  w.subscribe(RELEASES_SOURCE, releaseIndexer, {
    id: 'm29-release-cache',
    phase: 'projection',
    filter: JSON_FILTER,
  });

  // M33 phase 3: overlay reload. Only registered when the trust gate let the
  // mount exist at all. Invalidating THIS context retires it and the rebuilt
  // context mounts its own source, so a retired-but-not-yet-disposed context
  // (in-flight turn) cannot keep re-invalidating the projectId the new context
  // now owns — dispose unmounts this source.
  if (overlayMounted) {
    let overlayFired = false;
    const onOverlayChange = (relPath: string): void => {
      // Fire ONCE. Invalidating this context retires it, and the rebuilt context
      // mounts its own overlay source — but a retired context with an in-flight
      // turn is not disposed for a while, and every further save here would keep
      // invalidating the projectId its replacement now owns, destroying the
      // context the user is actually browsing. Unmounting stops that dead.
      if (overlayFired) return;
      overlayFired = true;
      void w.unmountSource(PLUGINS_OVERLAY_SOURCE);
      const abs = path.join(projectPluginsDir(cwd), relPath);
      const pkgs = affectedOverlayPackages(projectPluginsDir(cwd), [abs]);
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
    };
    w.subscribe(
      PLUGINS_OVERLAY_SOURCE,
      { onChange: (_s, _src, relPath) => onOverlayChange(relPath), onUnlink: (_s, _src, relPath) => onOverlayChange(relPath) },
      { id: 'm33-overlay-reload', phase: 'reload' },
    );
  }


  // The boot rebuild mints anchors but nothing dispatches for those files, so the
  // `write-back` phase never runs — drain the stash explicitly or the anchors
  // would live only in `section_index` and never reach the .md files.
  sectionIndexer
    .indexAll()
    .then(() => sectionIndexer.flushPendingInjections((source, relPath) => w.suppress(source, relPath)))
    .catch((err) => {
    console.error('[section-indexer] initial indexAll failed:', err);
  });

  todosIndexer.indexAll().catch((err) => {
    console.error('[todos-indexer] initial indexAll failed:', err);
  });

  pagesLinkIndexer.indexAll().catch((err) => {
    console.error('[pages-link-indexer] initial indexAll failed:', err);
  });

  // M17: initial sync of file_version. For each markdown file with no captured
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
        console.warn(`[file-version] initial sync failed for root '${rt.root.id}':`, (err as Error).message);
      }
    }
  })();

  // M36: initial sync — file_version baseline per artifact mount + frontmatter indexer.
  (async () => {
    for (const m of artifactMounts.values()) {
      try {
        const files = await m.pages.listMarkdownFiles();
        for (const relPath of files) {
          if (pageVersions.hasAny(relPath, m.entry.rootId)) continue;
          await pageVersions.recordVersion(relPath, 'create', 'filesystem', undefined, m.serializer, m.entry.rootId);
        }
      } catch (err) {
        console.warn(`[file-version] ${m.entry.kind}s initial sync failed:`, (err as Error).message);
      }
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
        // 0.2.11: the extra `isRawEntityType` narrowing here is gone. It was
        // added when the M29 store laid out one directory per CORE type and
        // accepted only those; the store now derives its directories from the
        // registry (`<type>/<slug>.json` for every active type), so restricting
        // the one-time DB→text export to seven literals would silently drop a
        // plugin type's entities from the very migration meant to rescue them.
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

    /**
     * 0.2.4 — before the rebuild, never after.
     *
     * The rebuild reads the files and projects their timestamps into the
     * columns. Running the backfill afterwards would mean the rebuild had
     * already minted a fresh "now" for every pre-0.2.4 entity, and the backfill
     * would then be writing files that disagree with the index it just built.
     * It also has to come after the DB→text export above, since that export is
     * what creates the files this walks.
     *
     * Idempotent by construction: a project whose files already carry both
     * fields short-circuits before any `git` spawn, so this costs one directory
     * walk per boot forever after.
     */
    try {
      backfillEntityTimestamps(db.handle, entityStore, cwd, entitiesDir);
    } catch (err) {
      // A missing timestamp degrades ordering; it does not stop the project
      // from serving. Never let the backfill be the reason boot fails.
      console.warn('[timestamp-backfill] skipped:', (err as Error).message);
    }

    await entityIndexer.indexAll();
  } catch (err) {
    console.error('[entity-indexer] boot indexAll failed:', err);
  }
  // M29: enable tags.json persistence only AFTER the boot rebuild, so any
  // auto-created tag during indexAll does not write files mid-rebuild.
  tagsService.setEntityStore(entityStore);
  // M29: enable slug-rename propagation into entity files — the rename is fanned
  // out to one listener per module, generated from that module's `ref` flags.
  // After indexAll, so the index is consistent before any listener reads it.
  referencesService.setPluginHost(pluginHost);

  // 0.1.119: Migration C — backfill on-disk release files for pre-slug
  // spec_release rows (created before 0.1.118 added releasesDir/<slug>.json).
  // MUST run before releaseIndexer.indexAll() just below, so a backfilled row
  // is picked up as a normal file-backed release on first rebuild rather than
  // treated as a DB row with no file. `roots` isn't a spec_release column —
  // reuse the CURRENT releasableRootIds as a best-effort snapshot, there is no
  // historical source. Per-row try/catch so one bad row can't block the rest
  // or the release-indexer rebuild that follows.
  try {
    const legacyReleases = db.handle
      .prepare(`SELECT * FROM spec_release WHERE slug IS NULL`)
      .all() as Array<{ id: number; name: string; description: string; created_by: string; created_at: string }>;
    if (legacyReleases.length > 0) {
      console.log(`[m29] backfilling ${legacyReleases.length} release(s) DB→disk into ${releasesDir} ...`);
      backupDbBeforeMigration(dbSlotDir);
      const setSlug = db.handle.prepare(`UPDATE spec_release SET slug = ? WHERE id = ?`);
      for (const row of legacyReleases) {
        try {
          // Two legacy names can slugify to the same string (e.g. differing
          // only by case/punctuation). Unlike `createRelease()`'s live-path
          // conflict check (which can reject a user's request outright), a
          // boot migration must make progress for every row — disambiguate
          // with a numeric suffix instead of leaving the loser's slug NULL
          // forever (which the old skip-with-warning behavior did).
          const baseSlug = slugify(row.name);
          let slug = baseSlug;
          let attempt = 1;
          while (releaseFileStore.exists(slug)) {
            const existing = releaseFileStore.read(slug);
            const matches =
              existing.name === row.name &&
              existing.description === row.description &&
              existing.createdAt === row.created_at &&
              existing.createdBy === row.created_by;
            if (matches) break; // idempotent re-run of a prior backfill for THIS row
            attempt++;
            if (attempt > 50) {
              throw new Error(`no free slug for '${row.name}' after ${attempt - 1} attempts`);
            }
            slug = `${baseSlug}-${attempt}`;
          }
          if (!releaseFileStore.exists(slug)) {
            releaseFileStore.write(slug, toReleaseFileData(row, slug, releasableRootIds));
          }
          setSlug.run(slug, row.id);
        } catch (err) {
          console.error(`[m29] release backfill failed for release id=${row.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[release-backfill] boot migration failed:', err);
  }

  // 0.1.118: boot rebuild of the spec_release derived cache from releasesDir.
  // Order relative to the entity rebuild doesn't matter (independent tables).
  try {
    await releaseIndexer.indexAll();
  } catch (err) {
    console.error('[release-indexer] boot indexAll failed:', err);
  }

  // NOTE: mounts are live from the moment `mountSource` runs (M40 phase A). The
  // boot export/rebuild below therefore writes through the entity store's
  // `suppress()` primitive, which is what keeps a bulk rebuild from re-entering
  // its own indexer.

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
    serialization: serializationEngine,
    ws,
    activeAdapters,
    pendingInputs,
    writingStyle,
    hasInFlightTurn: () => activeAdapters.size > 0,
    mcpSurfaceDeps,
    // M31 dispose sequence: this scope's mounts → MCP factories → room → db handle.
    dispose: async () => {
      // One call retires every mount and subscription of THIS context —
      // pages, artifacts, entities, releases and the plugin overlay — and settles
      // its pending debounce timers. `scope: 'process'` mounts (the base plugin
      // pool) and other contexts' mounts are untouched. This also closes the
      // pre-0.2.10 gap where `releasesWatcher` was never closed on dispose.
      await w.dispose();
      pluginHost.clearMcpFactories();
      // M33 phase 2: drop references to dynamically imported project-local
      // modules (next rebuild re-imports), alongside the MCP factory release.
      overlayResult?.dispose();
      gateway.closeRoom(projectId);
      db.close();
    },
  };
}

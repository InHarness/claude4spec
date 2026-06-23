/**
 * Server-side plugin manifest. Extends the shared EntityModuleManifest with
 * server-only slots (serializer, services, mcpServer, routes, systemPrompt).
 *
 * `serializer` and `systemPrompt` are required; backend slots
 * (services, mcpServer, routes, migrations) are optional and filled per
 * entity in their vertical slice plugin.ts.
 */

import type { Database } from 'better-sqlite3';
import type { Router } from 'express';
import type { McpServerInstance } from '@inharness-ai/agent-adapters';
import type {
  EntityModuleManifest,
  PluginActivationState,
  SystemPromptContribution,
} from '../../../shared/plugin-host/types.js';
import type {
  PluginCommandContribution,
  PluginManifest,
  PluginSettingsSection,
  WritingStyleContribution,
} from '../../../shared/plugin-host/manifest.js';
import type {
  EntityDiff,
  EntitySerializer,
  RestoreContext,
  RestoreResult,
  SerializeContext,
  SnapshotData,
} from '../../serialization/types.js';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import type { EntityStore } from '../../services/entity-store.js';

export type SqlMigration = {
  /** Per-plugin sequential version. Starts at 1 (post-baseline). */
  version: number;
  /** Short identifier, e.g. "add_summary_column". */
  name: string;
  /** Idempotent SQL — must tolerate replay. */
  up: string;
};

export interface RouteRegistration {
  /** Mount prefix, e.g. "/api/endpoints". */
  prefix: string;
  /** Express subrouter — handler chain owned by the plugin. */
  router: Router;
}

/**
 * Mount-time context passed to each plugin's `backend.mount(ctx)`. Carries
 * cross-cutting deps + helpers for registering routes / MCP servers / id
 * resolvers without per-plugin special-casing in index.ts.
 */
export interface MountContext {
  /**
   * M31: per-project Express Router (NOT the process-level app). Plugins only
   * call `.use(pathPrefix, …)` — the dispatch middleware mounts the whole
   * router under `/api/projects/:id`, so prefixes are `/api`-less.
   */
  app: Router;
  db: Database;
  /** M31: the project host being mounted — plugins needing host lookups (e.g. ac) use this, never a singleton. */
  host: ProjectPluginHost;
  /** Project root — needed by plugins that run an LLM adapter (e.g. ac-tools analyze). */
  cwd: string;
  ws: WsEmitter;
  tagsService: TagsService;
  versionService: VersionService;
  referencesService: ReferencesService;
  /** M29: file store — entity services persist their JSON file after each mutation. */
  entityStore: EntityStore;
  /**
   * Register a *factory* that builds a fresh MCP server instance. The host
   * invokes it once per agent turn (see `buildMcpServers`) so each
   * `adapter.execute()` gets its own `McpServer` — sharing one instance across
   * concurrent turns breaks, because MCP `Protocol.connect` throws once an
   * instance already holds a transport.
   */
  registerMcpServer(name: string, factory: () => McpServerInstance): void;
  /**
   * M17: register the entity's L2 service with the host so cross-cutting
   * consumers (release restore) can drive idempotent UPSERT through normal
   * write-API. Stored untyped — callers cast on retrieval.
   */
  registerEntityService(type: string, service: unknown): void;
}

/**
 * Per-plugin mount hook. Constructs the entity service from cross-cutting
 * deps + db, mounts its Express subrouter under `/api${pathPrefix}`, registers
 * the MCP server as `${type}-tools`, and registers the entity service.
 */
export type PluginMountFn = (ctx: MountContext) => void;

export interface BackendModule extends EntityModuleManifest {
  /** L9 — JSON serialization for external consumers (CLI, MCP, ...). */
  serializer: EntitySerializer<unknown>;

  /** M05 — system prompt contribution composed by buildSystemPrompt. */
  systemPrompt: SystemPromptContribution;

  /**
   * L1–L4 backend slots. The `mount` hook is the single entry point used by
   * `pluginHost.mountBackend(ctx)` — it owns service construction, route
   * mounting, MCP registration, and id resolver wiring.
   */
  backend?: {
    migrations?: SqlMigration[];
    mount?: PluginMountFn;
  };
}

/**
 * M33: per-`ProjectContext` overlay of project-local plugins loaded
 * from `<cwd>/.claude4spec/plugins/` (behind the `trustProjectPlugins` gate).
 * The overlay is relative to the project — two projects in one process carry
 * different overlays. `listLocal()` returns already-validated, trust-gated
 * modules; `origin(type)` maps a type back to its source path under
 * `.claude4spec/plugins/` for diagnostics (shadow report).
 */
export interface ProjectPluginOverlay {
  /** Project-local modules of THIS project (post validation + trust gate). */
  listLocal(): BackendModule[];
  /** Source path under `<cwd>/.claude4spec/plugins/` for the given type. */
  origin(type: string): string;
  /**
   * M33 — Settings sections contributed by trusted project-local
   * plugins (one per plugin with `contributes.settings`). Trust is implicit:
   * the overlay is built only on the trusted path.
   */
  listSettings(): PluginSettingsSection[];
  /** M33 — declarative editor commands from trusted project-local plugins. */
  listCommands(): PluginCommandContribution[];
}

/**
 * M33 — a registered base-layer plugin, retained by the registry so the
 * host can surface its non-entity capabilities (settings/commands) and the
 * hot-reload pipeline can tear it down via `onUnregister` before re-registering.
 */
export interface RegisteredPluginRecord {
  name: string;
  version: string;
  /** Entity types this plugin contributed (for unregister + diagnostics). */
  contributedTypes: string[];
  settings: PluginSettingsSection['fields'];
  commands: PluginCommandContribution[];
  /** Required teardown hook (idempotent, non-throwing by contract). */
  onUnregister: () => void;
}

/** One overlay type that shadows a same-named base type (cross-layer collision). */
export interface ShadowedType {
  type: string;
  /** Source path of the overlay module that won. */
  overlayOrigin: string;
}

/**
 * M31 split: process-immutable plugin catalog. Populated once at process
 * start via `registerAllPlugins(registry)`; `consolidate` is a PURE factory —
 * it derives a per-project ProjectPluginHost and mutates nothing here.
 */
export interface PluginRegistry {
  /** Register a plugin manifest. Idempotent on `module.type`. */
  registerEntityModule(module: BackendModule): void;

  /**
   * M33: register a runtime plugin manifest. Validates the manifest shape and
   * fans `contributes.entities[]` out to `registerEntityModule(...)` (each
   * lowered from its authoring shape). Throws `PluginManifestError` on a
   * structurally invalid manifest — the loader catches this per-package. Does
   * NOT gate on hostApiVersion/engines (that is the loader's job).
   */
  registerPlugin(manifest: PluginManifest): void;

  /**
   * M33 — validate a manifest's shape + lower all its contributions
   * WITHOUT mutating the registry; throws on a structural problem. The reload
   * pipeline calls this before `unregisterPlugin` so a structurally-broken new
   * version never leaves the pool missing a type (atomic "old stays").
   */
  validatePlugin(manifest: PluginManifest): void;

  /**
   * M33 — tear down a previously-registered base plugin by name: call
   * its `onUnregister` (idempotent, non-throwing) and drop its entity modules +
   * retained capability record. The hot-reload pipeline calls this on the OLD
   * version before re-`registerPlugin`-ing the fresh module. No-op for an
   * unknown name.
   */
  unregisterPlugin(name: string): void;

  /** M33 — retained base-layer plugin records (for capabilities + reload). */
  listPluginRecords(): RegisteredPluginRecord[];

  /** All registered modules, regardless of activation. */
  listAvailable(): BackendModule[];

  /** Lookup including inactive — used for broken-chip categorisation. */
  getAvailable(type: string): BackendModule | null;

  /**
   * M15: writing styles contributed by base-layer (workspace/npm)
   * plugins, collected during `registerPlugin`. Pushed into each project's
   * SkillRegistry as `source: "plugin"` at context build (project-local overlay
   * styles are pushed separately, behind the trust gate).
   */
  listWritingStyles(): WritingStyleContribution[];

  /**
   * Derive a per-project host. The effective pool is `base ∪ overlay`
   * (base ∪ overlay); the `config.entities` whitelist is applied to that merged
   * pool, not to the base alone. `config.entities === undefined` ⇒ all available
   * active (v1 backward compat). `overlay === undefined` ⇒ effective pool =
   * base (parity with the base-only case). No side effects.
   */
  consolidate(
    config: { entities?: string[] } | null | undefined,
    overlay?: ProjectPluginOverlay,
  ): ProjectPluginHost;
}

/** Plugin self-registration hook — exported by each entities/*\/plugin.ts. */
export type PluginOnRegister = (registry: PluginRegistry) => void;

export interface ProjectPluginHost {
  /** All registered modules, regardless of activation (delegates to the registry). */
  listAvailable(): BackendModule[];

  /** Active modules only (filtered by the consolidated whitelist). */
  listEntities(): BackendModule[];

  /**
   * M33 — Settings sections of ALL loaded + trusted plugins in the
   * effective pool (base ∪ trusted overlay), one per plugin with
   * `contributes.settings`. Deliberately does NOT filter by `config.entities`
   * (contrast with `listEntities()`): a plugin's settings survive deactivation
   * of its entity types — the user needs the panel to re-enable them. This is
   * axis B (pool + trust), not axis A (entity whitelist).
   */
  listSettings(): PluginSettingsSection[];

  /**
   * M33 — declarative editor slash-commands of ALL loaded + trusted
   * plugins, independent of `config.entities` (same two-axis rationale as
   * `listSettings()`). Routed into the editor via `registerEditorExtension`.
   */
  listCommands(): PluginCommandContribution[];

  /** Lookup by type — returns null for inactive or unknown. */
  getEntity(type: string): BackendModule | null;

  /** Lookup including inactive — used for broken-chip categorisation. */
  getAvailable(type: string): BackendModule | null;

  isActive(type: string): boolean;

  /** Activation snapshot — input for GET /_meta/entities. (Rename of `state()`.) */
  partition(): PluginActivationState;

  /**
   * M33: overlay types that shadow a same-named base type. Empty when
   * there is no overlay or no cross-layer collision. Feeds the per-project
   * `/_meta/plugins` shadow report and the M19 consistency check.
   */
  shadowReport(): ShadowedType[];

  /**
   * Mount every active backend module into the supplied Express app + the
   * host-internal MCP registry. Iterates `listEntities()` and invokes each
   * plugin's `backend.mount(ctx)`. Inactive plugins are skipped — no routes,
   * no MCP server, no id resolver registered.
   */
  mountBackend(ctx: MountContext): void;

  /**
   * Register an MCP server *factory* under a unique name (e.g. "dto-tools").
   * Stored as a thunk, not an instance: `buildMcpServers` calls it per turn so
   * each agent run gets a fresh `McpServer` (concurrent turns must not share
   * one instance — see the MountContext note).
   */
  registerMcpServer(name: string, factory: () => McpServerInstance): void;

  /**
   * Build a fresh MCP server instance from every registered factory. Called
   * once per agent turn by the chat handler to wire the adapter. Each call
   * produces brand-new instances, so concurrent turns never collide on a
   * shared transport.
   */
  buildMcpServers(): Array<{ name: string; server: McpServerInstance }>;

  /**
   * Run each active plugin's `systemPrompt.countStat.sqlQuery` against the db
   * and return the results indexed by `module.type`. Used by the chat handler
   * to populate `SystemPromptInput.entityCounts`.
   */
  computeEntityCounts(db: Database): Record<string, number>;

  /**
   * M29: existence check by slug (the sole entity identity). Delegates to the
   * registered entity service's `getBySlug`. Consumed by section-indexer and
   * reference-tools to validate page-level mentions without per-type switches.
   */
  entityExists(type: string, slug: string): boolean;

  /**
   * M17 entity service registry. Plugins register their L2 service during
   * mount; cross-cutting consumers (releaseService restore) retrieve them by
   * type. Untyped surface — caller casts to the concrete service type.
   */
  registerEntityService(type: string, service: unknown): void;
  getEntityService(type: string): unknown;

  // ─── M17 snapshot helpers ────────────────────────────────────────────────
  /** Plugin-owned snapshot. Throws SnapshotNotImplementedError if slot absent. */
  snapshot(type: string, entity: unknown, ctx: SerializeContext): SnapshotData;
  /** Plugin-owned restore (UPSERT through normal write-API). */
  restore(type: string, data: SnapshotData, ctx: RestoreContext): RestoreResult;
  /** Plugin-owned diff with default deep-diff fallback. */
  diff(type: string, a: SnapshotData, b: SnapshotData, slug: string): EntityDiff;

  /** M31 dispose: drop per-project MCP factories so a retired context leaks nothing. */
  clearMcpFactories(): void;
}

/**
 * Back-compat alias — pre-M31 consumers typed against the singleton's
 * interface name. The per-project host is the only host shape now.
 */
export type PluginHost = ProjectPluginHost;

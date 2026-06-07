/**
 * Server-side plugin manifest. Extends the shared EntityModuleManifest with
 * server-only slots (serializer, services, mcpServer, routes, systemPrompt).
 *
 * `serializer` and `systemPrompt` are required; backend slots
 * (services, mcpServer, routes, migrations) are optional and filled per
 * entity in their vertical slice plugin.ts.
 */

import type { Database } from 'better-sqlite3';
import type { Application, Router } from 'express';
import type { McpServerInstance } from '@inharness-ai/agent-adapters';
import type {
  EntityModuleManifest,
  PluginActivationState,
  SystemPromptContribution,
} from '../../../shared/plugin-host/types.js';
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
import type { WsGateway } from '../../ws/gateway.js';
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
  app: Application;
  db: Database;
  ws: WsGateway;
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

export interface PluginHost {
  /** Register a plugin manifest. Idempotent on `module.type`. */
  registerBackendModule(module: BackendModule): void;

  /**
   * Apply config.entities whitelist; updates active/inactive/unknown sets.
   * Pass undefined / null = all available are active (v1 backward compat).
   */
  consolidate(activeWhitelist: string[] | null | undefined): void;

  /** All registered modules, regardless of activation. */
  listAvailable(): BackendModule[];

  /** Active modules only (filtered by `consolidate`). */
  listEntities(): BackendModule[];

  /** Lookup by type — returns null for inactive or unknown. */
  getEntity(type: string): BackendModule | null;

  /** Lookup including inactive — used for broken-chip categorisation. */
  getAvailable(type: string): BackendModule | null;

  isActive(type: string): boolean;

  /** Activation snapshot — input for GET /api/_meta/entities. */
  state(): PluginActivationState;

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
}

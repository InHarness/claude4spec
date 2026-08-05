/**
 * Server-side plugin manifest. Extends the shared EntityModuleManifest with
 * server-only slots (serializer, services, mcpServer, routes, systemPrompt).
 *
 * `serializer` and `systemPrompt` are required; backend slots
 * (services, mcpServer, routes) are optional and filled per
 * entity in their vertical slice plugin.ts.
 */

import type { Database } from 'better-sqlite3';
import type { Router } from 'express';
import type { ZodRawShape } from 'zod';
import type { McpServerFactory } from '../../../shared/plugin-host/mcp.js';
import type {
  EntityModuleManifest,
  PluginActivationState,
  SystemPromptContribution,
} from '../../../shared/plugin-host/types.js';
import type { ChangedBy } from '../../../shared/entities.js';
import type { Root } from '../../../shared/types.js';
import type { UpsertResult } from '../../serialization/writer.js';
import type { SystemStamp } from '../../serialization/system-fields.js';
import type { EntityCrudService } from './entity-crud-service.js';
import type {
  PluginCommandContribution,
  PluginManifest,
  PluginSettingsSection,
  WritingStyleContribution,
} from '../../../shared/plugin-host/manifest.js';
import type {
  EntityDiff,
  RestoreContext,
  RestoreResult,
  SerializationContribution,
  SnapshotData,
} from '../../serialization/types.js';
import type { RawEntityReader } from '../../discovery/raw-entity-reader.js';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import type { EntityStore } from '../../services/entity-store.js';
import type { ExtensionReferenceType } from '../../../shared/reference-extensions.js';

/**
 * v0.1.129 (M19 Slot B) — an entity module's own self-closing XML reference
 * tag (e.g. `<diagram/>`), everything `ExtensionReferenceType` needs EXCEPT
 * `entityType`: `registerEntityModule` injects `entityType = module.type`
 * itself when forwarding to the M19 registry, so a module can't declare a
 * mismatched one.
 */
export type EntityReferenceType = Omit<ExtensionReferenceType, 'entityType'>;

/**
 * 0.2.2 — write-path options a service's restore/write facade accepts.
 *   - `capture`   gates the `entity_version` capture inside the mutation
 *                 (false on the index-rebuild path, true on a real restore).
 *   - `writeFile` gates re-persisting the entity's JSON file (always false on
 *                 both restore paths — the caller owns the file write).
 *   - `stamp`     (0.2.4) carries the entity file's `createdAt`/`updatedAt` so
 *                 the service writes them into its columns VERBATIM instead of
 *                 minting `datetime('now')`. Optional: a user mutation has no
 *                 file behind it yet and lets the service mint one.
 */
export interface WriteOpts {
  capture: boolean;
  writeFile: boolean;
  stamp?: SystemStamp;
}

/**
 * 0.2.2 — surface (B) of an entity service: the rich restore/write-path facade.
 * Consumed STRUCTURALLY (by shape, never by class) through
 * `host.getEntityService(type)` / `requireService(type)`, which is what lets a
 * type contributed by any plugin have a restore door without the host importing
 * — or even naming — its service class.
 */
export interface UpsertCapable<T = unknown> {
  upsert(slug: string, input: unknown, actor: ChangedBy, opts?: WriteOpts): UpsertResult<T>;
  getBySlug(slug: string): T | null;
  remove(slug: string, actor: ChangedBy): void;
}

/**
 * 0.2.2 — what `getEntityService(type)` hands back.
 *
 * One service INSTANCE exposes two disjoint surfaces, and a given type may
 * implement either or both, hence `Partial` on each half:
 *   (A) `EntityCrudService` — the thin agent-facing create/get/update/delete/list
 *       consumed only by the generic `entity-tools` MCP server.
 *   (B) `UpsertCapable`     — the rich restore/write-path facade used by
 *       `EntityWriter`, the release layer, `c4s-reader` and the indexer.
 * Callers narrow by probing the method they need, never by casting to a class.
 */
export type EntityServiceLike = Partial<EntityCrudService> & Partial<UpsertCapable>;

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
  /**
   * 0.2.8 (A19): the project's effective page roots. Plugins that run an LLM adapter need
   * them together with `cwd` to resolve the same FS path scope as the chat turn — the CLI
   * `--pages` override means they are not always what `config.json` holds.
   */
  roots: Root[];
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
  registerMcpServer(name: string, factory: () => McpServerFactory): void;
  /**
   * M17: register the entity's L2 service with the host so cross-cutting
   * consumers (release restore) can drive idempotent UPSERT through normal
   * write-API. Stored untyped — callers cast on retrieval.
   */
  registerEntityService(type: string, service: unknown): void;
  /**
   * 0.2.2: register a handler for "some entity was renamed". Used by
   * `synthesizeMount` to bind the listener generated from a module's `ref`
   * flags; a module writing `mount` by hand can call it directly.
   */
  registerRenameListener(fn: (ev: EntityRenamedEvent) => void): void;
}

/**
 * Per-plugin mount hook. Constructs the entity service from cross-cutting
 * deps + db, mounts its Express subrouter under `/api${pathPrefix}`, registers
 * the MCP server as `${type}-tools`, and registers the entity service.
 */
export type PluginMountFn = (ctx: MountContext) => void;

/** 0.2.2 — an entity changed slug. See `registerRenameListener`. */
export interface EntityRenamedEvent {
  type: string;
  oldSlug: string;
  newSlug: string;
}

export interface BackendModule extends EntityModuleManifest {
  /** L9 — computed views + semantic diff; everything else is derived. */
  serializer: SerializationContribution<unknown>;

  /** M05 — system prompt contribution composed by buildSystemPrompt. */
  systemPrompt: SystemPromptContribution;

  /**
   * L1–L4 backend slots. Either declare `service`/`routes`/`mcpServer`
   * (the host synthesizes an equivalent `mount`, see
   * `manifest-adapter.ts#synthesizeMount`) or write `mount` directly as an
   * escape hatch — `mount`, when present, always wins.
   */
  backend?: {
    mount?: PluginMountFn;
    /**
     * L2 DOMAIN-HELPER factory, instantiated once per `ProjectContext` and
     * registered under `getEntityService(type)`.
     *
     * 2.0.0 tier K: this stopped being a CRUD service. The six that were one are
     * deleted; what a type may still contribute here is domain logic the host
     * cannot derive from `data.schema` — `ac`'s LLM analysis service,
     * `design-system`'s `resolve(groups, modes, activeMode?)`. Hence `unknown`:
     * the host neither knows nor needs the shape, and typing it as
     * `EntityCrudService` invited exactly the by-shape `?.upsert` probing that
     * kept the deleted write fork alive.
     *
     * 2.0.0 tier K — `crud` was REMOVED. Its `createSchema`/`updateSchema` are
     * generated from `data.schema` (item 27, `crud-schema-gen.ts`); a second
     * hand-written description of the same fields could only ever drift from the
     * table, the payload and the write door, which is what it did.
     */
    service?: (ctx: MountContext) => unknown;
    /**
     * A factory receiving the same service instance as `mcpServer`.
     * ALWAYS a factory (never a bare `Router`) — express's `Router` type is
     * itself callable (`(req, res, next) => void`), so a `Router | (fn)`
     * union can't be discriminated at runtime by `typeof x === 'function'`
     * (true for both members). A plugin with no service dependency just
     * ignores the arguments: `router: (_service, _ctx) => myRouter`.
     */
    routes?: {
      router: (service: EntityCrudService, ctx: MountContext) => Router;
    };
    /**
     * Custom `${type}-tools` server for this type's non-CRUD tools. 0.1.133:
     * the slot returns the MCP server HANDLE directly — the result of
     * `createMcpServer(...)` (published as the opaque C4S `McpServerFactory`) —
     * NOT a `() => instance` thunk. Per-turn freshness is host-owned: the host
     * wraps this factory in a per-turn thunk in `synthesizeMount`
     * (`registerMcpServer`), so `buildMcpServers()` rebuilds a fresh, connectable
     * server each turn behind the facade.
     */
    mcpServer?: (service: EntityCrudService, ctx: MountContext) => McpServerFactory;
    /**
     * 0.2.2 — AUXILIARY tables this module owns beyond `table` itself: junctions
     * and side indexes whose rows are derived from the entity files and so must
     * be cleared when the index is rebuilt from scratch.
     *
     * Declared rather than callback-shaped on purpose: the index rebuild runs in
     * one transaction, and a name in an array can be validated as an identifier
     * and skipped when the table does not exist. Arbitrary code inside that
     * transaction could roll the whole rebuild back.
     *
     * The host clears these; it never interprets them. It is the module's job to
     * repopulate them from its own restore path.
     */
    auxTables?: string[];
    /*
     * 2.0.0 — `onEntityRenamed` was REMOVED. The host knows an entity was
     * renamed AND, since `data.schema`, which fields reference it: the `ref`
     * flag is the declaration the three hooks were three spellings of. The
     * generated listener lives in `synthesizeMount` and the rewrite in
     * `db/ref-rewrite.ts`; nothing about the fan-out changed.
     */
  };

  /**
   * v0.1.129 (M19 Slot B) — declarative frontend contributions. Currently just
   * `referenceType`, forwarded by `registerEntityModule` to
   * `M19.registerExtensionReferenceType` with `entityType` auto-injected.
   * Additive/optional — folds into the `1.0.0` host API baseline, same as the
   * `backend.{service,routes,mcpServer}` declarative slots above.
   */
  frontend?: {
    referenceType?: EntityReferenceType;
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
  registerMcpServer(name: string, factory: () => McpServerFactory): void;

  /**
   * 0.2.2 — rename listeners contributed by modules at mount time. The host
   * collects them; `ReferencesService` fans a rename out to all of them so no
   * host code has to know which types embed which other type's slug.
   */
  registerRenameListener(fn: (ev: EntityRenamedEvent) => void): void;
  listRenameListeners(): Array<(ev: EntityRenamedEvent) => void>;

  /**
   * 2.0.0 — hand the host the project's index, so `entityExists` can answer for a
   * type that declares `data.schema` and registers no `backend.service`. Wired
   * post-construction: `consolidate` is a pure factory that runs before the
   * database exists.
   */
  setRawReader(reader: RawEntityReader): void;

  /**
   * Build a fresh MCP server instance from every registered factory. Called
   * once per agent turn by the chat handler to wire the adapter. Each call
   * produces brand-new instances, so concurrent turns never collide on a
   * shared transport.
   */
  buildMcpServers(): Array<{ name: string; server: McpServerFactory }>;

  /**
   * Entity counts for the active types, keyed by `module.type`, in
   * `listEntities()` order. Used by the chat handler to populate
   * `SystemPromptInput.entityCounts`.
   *
   * 0.2.4: counted by the host through `RawEntityReader.count(type)` and
   * labelled with the manifest's `labelPlural`. It no longer executes
   * `systemPrompt.countStat.sqlQuery` — that slot was the one place a module
   * handed the host raw SQL to run. The acceptance criterion is that this
   * aggregate and the sidebar's return the SAME number for the same type.
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
   * mount; cross-cutting consumers retrieve them by type.
   *
   * 0.2.2: the retrieval side is no longer `unknown`. It returns the structural
   * `EntityServiceLike` — the single door through which EVERY host-side consumer
   * of a type's service (EntityWriter/M17 restore, the L4 write-path, the release
   * layer, c4s-reader/M12, the indexer/M29) must go. None of them may
   * `import { XService } from '…/entities/…'` any more; they consume the service
   * BY SHAPE. Returns `null` when the type is inactive in this project OR
   * contributed no `backend.service` slot.
   *
   * Boundary: the cross-cutting HOST services on `MountContext`
   * (`tagsService`, `versionService`, `referencesService`, `entityStore`) are
   * host-owned and deliberately NOT subject to this rule.
   */
  registerEntityService(type: string, service: unknown): void;
  getEntityService(type: string): EntityServiceLike | null;

  /**
   * Same lookup as `getEntityService`, but throws instead of returning `null`.
   * Use it where the absence of a service is a programming error; use
   * `getEntityService` where it is a legitimate "this type has no write door"
   * outcome the caller reports as a skip (see `restoreEntity`).
   */
  requireService(type: string): EntityServiceLike;

  // ─── M17 snapshot helpers ────────────────────────────────────────────────
  /** Plugin-owned snapshot. Throws SnapshotNotImplementedError if slot absent. */
  snapshot(type: string, entity: unknown, reader: RawEntityReader): SnapshotData;
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

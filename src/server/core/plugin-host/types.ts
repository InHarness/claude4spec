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
import type { McpServerFactory, McpToolDeclaration } from '../../../shared/plugin-host/mcp.js';
import type {
  EntityModuleManifest,
  PluginActivationState,
  SystemPromptContribution,
} from '../../../shared/plugin-host/types.js';
import type { ChangedBy } from '../../../shared/entities.js';
import type { Root } from '../../../shared/types.js';
import type { DiscoveryCore } from '../../discovery/types.js';
import type { UpsertResult } from '../../serialization/writer.js';
import type { SystemStamp } from '../../serialization/system-fields.js';
import type {
  PluginCommandContribution,
  PluginManifest,
  PluginSettingsSection,
  PluginSkillContribution,
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
 * What `getEntityService(type)` hands back — 2.0.0 tier K: `unknown`.
 *
 * It used to be `Partial<EntityCrudService> & Partial<UpsertCapable>`: two
 * disjoint surfaces (the agent-facing CRUD one and the rich restore/write
 * facade) that callers narrowed by probing for the method they wanted. Both are
 * gone. CRUD is generated from `data.schema`, and the restore/write path goes
 * through `upsertProjectionRow` for every type — so the `?.upsert` probing that
 * type invited is exactly what tier K removed, and leaving the shape behind
 * would invite writing it again.
 *
 * What a type may still register here is a DOMAIN HELPER the host cannot derive
 * and does not understand (`ac`'s LLM audit is the only in-repo example, and it
 * is reached by its own MCP server, not through this lookup). `unknown` says
 * that: whoever registered it is the only code that knows what it is.
 */
export type EntityServiceLike = unknown;

/**
 * 2.0.0 (A.8) — the write door handed to a plugin's `mount`, bound to this
 * project's deps.
 *
 * A FACADE, not the host's `GenericCrudDeps` bag: a plugin cannot import
 * `genericCreate`/`genericUpdate` (they are host internals, and the published
 * `MountContext` types every host handle as `any` precisely so the contract
 * carries no host imports), so handing over the deps object would give it
 * something it has no way to call. These methods are the whole of what a
 * declarative type's write path is, and the first three are the SAME ones
 * `/api/{type}s` goes through — including validation, slug rules,
 * `entity_version` capture and the entity-file write.
 *
 * The two keyed operations share the capture and the file write but NOT the
 * REST half: no generated route reaches them (the M39 collection routes are
 * read-only by design), so they also do not run the generated create/update
 * schema. Their validation is the write path's own — the entry list, the
 * coordinates, the extents, the declared enums — and it rejects rather than
 * warns: a partial write is rolled back whole.
 *
 * `type` is a parameter rather than bound because a plugin legitimately writes
 * types other than its own (`endpoint` reads `dto` to validate a link).
 *
 * ASYNC, and not merely as a convenience: `update` propagates a rename to every
 * referencing entity and page, which is I/O. A synchronous facade could only
 * have skipped that step — which is exactly what the first version did.
 *
 * The last two exist because whole-entity verbs cannot express a KEYED
 * collection's write. `update` reconciles a supplied keyed collection
 * REPLACE-ALL, so changing one cell means resending the entire grid — which
 * defeats windowing, and makes two writers to disjoint cells overwrite each
 * other. `writeCollectionWindow` merges instead: only the keys named are
 * touched. Both go through the same domain write-path as the verbs above, so a
 * cell write stamps the parent's `updatedAt` and captures exactly ONE
 * `entity_version` row per call, whether it carried one key or a hundred.
 */
export interface CrudFacade {
  create(type: string, input: unknown, actor: ChangedBy): Promise<{ slug: string; warnings?: string[] }>;
  update(
    type: string,
    slug: string,
    input: unknown,
    actor: ChangedBy,
  ): Promise<{ slug: string; warnings?: string[] }>;
  delete(type: string, slug: string, actor: ChangedBy): Promise<{ deleted: boolean }>;
  /**
   * Point or range write into a keyed collection — a MERGE of the named keys.
   *
   * Each entry carries its own coordinates (the node's `keyFields`) alongside
   * the item payload. An entry whose payload is empty DELETES that key: a keyed
   * collection is sparse, so "no value here" and "no row here" are the same
   * state, and there is no separate delete verb to get them out of step.
   */
  writeCollectionWindow(
    type: string,
    slug: string,
    field: string,
    entries: readonly Record<string, unknown>[],
    actor: ChangedBy,
  ): Promise<{ slug: string; warnings?: string[] }>;
  /**
   * Insert or remove one position on an axis, reindexing every element behind
   * it and updating the parent's extent field.
   *
   * Not derivable from writing the extent through `update`: `nRows = 4` on a
   * 5-row grid does not say WHICH row went. Returns the extent AFTER the
   * operation — the caller cannot compute it, since keys are not a stable
   * identity across this call and a cached one now addresses a different item.
   */
  mutateCollectionAxis(
    type: string,
    slug: string,
    field: string,
    axisKey: string,
    op: 'insert' | 'delete',
    at: number,
    actor: ChangedBy,
  ): Promise<{ slug: string; extent: number }>;
}

/*
 * 2.0.0 — `RouteRegistration { prefix, router }` was REMOVED with
 * `routes.prefix`. A plugin's router is mounted at the module's `pathPrefix`, so
 * a per-registration prefix is no longer a thing a plugin can choose, and the
 * `routes` slot is `{ router }` alone. The interface outlived its last consumer
 * and was carrying a field the changelog lists as removed.
 */

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
  /**
   * 2.0.0 (A.8) — `db: Database` was REMOVED, and these two replace it.
   *
   * The raw handle was here because every type built a CRUD service around it;
   * tier K deletes those, and what the survivors actually need is narrower. A
   * `Database` is arbitrary SQL — a plugin could write a projection row the host
   * never validated, in a shape the declaration does not describe, which is the
   * whole class of thing 2.0.0 removes. `reader` is read-only by construction,
   * and `crud` is the SAME write door the generated router uses, so a plugin's
   * own route and `/api/{type}s` cannot disagree about what a write means.
   */
  reader: RawEntityReader;
  crud: CrudFacade;
  /** M31: the project host being mounted — plugins needing host lookups (e.g. ac) use this, never a singleton. */
  host: ProjectPluginHost;
  /**
   * 0.2.24 — the M39 read core, for a plugin that needs to READ an entity of
   * some OTHER type (`ac-tools`' semantic audit reads what each AC verifies).
   *
   * A thunk, because `mountBackend` runs before the context assembles its core:
   * the core is built over the plugin registry, which is what mounting fills.
   * Every consumer resolves it at tool-call time, long after both exist.
   *
   * It is the core rather than the serialization engine on purpose. The engine
   * is the registry, and an architecture gate holds it to one caller — reaching
   * it from a plugin would fork the read path, which is exactly the asymmetry
   * M39 exists to close.
   */
  discovery: () => DiscoveryCore;
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
   * invokes it once per `adapter.execute()` (see `buildMcpServers`) so every SDK
   * query gets its own `McpServer` — sharing one instance across two queries
   * breaks, because MCP `Protocol.connect` throws once an instance already holds
   * a transport, and its `_onclose` nulls the binding the OTHER query is using.
   *
   * The unit is the QUERY, not the turn. A turn issues one query for its initial
   * prompt plus one per merged-dispatch drain (`routes/agent-turn.ts`), so
   * "per turn" — what this said before brief `0-2-23-to-next` — silently reused
   * instances and made every whitelisted server stop answering mid-turn.
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
  /**
   * L9 — the payload's history, and nothing else.
   *
   * 0.2.24 removed the `serializer` container this slot used to sit in. It had
   * been shrinking for four releases — `snapshot`/`restore` went in 0.2.9,
   * `views` in 0.2.23 — until what remained was not a serializer in any sense.
   * 0.2.31 took the last of its company, `diff?`: the delta is generated from
   * `data.schema`, so the one axis a schema genuinely cannot express is the only
   * one left here.
   *
   * `payloadUpgrades[i]` takes payload `i+1` to `i+2`; `payloadVersion`
   * (required, on the manifest) is cross-checked against the chain's length.
   */
  payloadUpgrades?: SerializationContribution<unknown>['payloadUpgrades'];

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
      router: (service: unknown, ctx: MountContext) => Router;
    };
    /**
     * Custom `${type}-tools` server for this type's non-CRUD tools. 0.1.133:
     * the slot returns the MCP server HANDLE directly — the result of
     * `createMcpServer(...)` (published as the opaque C4S `McpServerFactory`) —
     * NOT a `() => instance` thunk. Per-QUERY freshness is host-owned: the host
     * wraps this factory in a thunk in `synthesizeMount` (`registerMcpServer`),
     * so `buildMcpServers()` rebuilds a fresh, connectable server for every
     * `adapter.execute()` behind the facade — see `registerMcpServer` on why the
     * unit is the query and not the turn.
     */
    mcpServer?: (service: unknown, ctx: MountContext) => McpServerFactory;
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

  /*
   * 0.2.15 — the `frontend.referenceType` slot was REMOVED, and with it the
   * whole `frontend` object, which had no other member. An entity no longer
   * brings a tag of its own; it is embedded through the generic M19 tags
   * dispatched on `type=`, and brings its appearance through the client-side
   * `renderChip` / `renderCard` / `renderRow` slots instead.
   */
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
 * hot-reload pipeline can drop the whole record on re-registration. Retaining
 * the record IS the fan-out: skills, the settings descriptor and the commands
 * are all read off it by their consumers, so deleting it unwires them.
 */
export interface RegisteredPluginRecord {
  name: string;
  version: string;
  /** Entity types this plugin contributed (for unregister + diagnostics). */
  contributedTypes: string[];
  settings: PluginSettingsSection['fields'];
  commands: PluginCommandContribution[];
  /**
   * 0.2.29 — OPTIONAL teardown hook for the plugin's OWN resources (see
   * `PluginManifest.onUnregister`). `undefined` when the manifest declares none,
   * which is the normal case for a purely declarative package. The registry does
   * NOT call it; the reload pipeline reads it off this record and calls the OLD
   * version's hook before `unregisterPlugin`.
   */
  onUnregister?: () => void;
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
   * M33 — the mirror of `registerPlugin`: drop a previously-registered base
   * plugin by name, fanning out BACKWARDS over its `contributedTypes[]`. Removes
   * its entity modules (so the types fall out of `listAvailable()`/`getAvailable`)
   * and its retained capability record — and with the record go the skills, the
   * `config.plugins[<name>]` settings DESCRIPTOR and the commands, since all
   * three are pull-read off it. Config VALUES are untouched.
   *
   * 0.2.29 — this clears the REGISTRY only. It no longer calls the plugin's
   * `onUnregister` (the reload pipeline owns that, and calls it first), and it
   * does not remove what is MOUNTED — Express routes, MCP server factories and
   * DI services come down on `ProjectContext` invalidation + rebuild. Only both
   * operations together guarantee no duplicated slots after a reload.
   *
   * Idempotent: a no-op, not an error, for a name absent from the registry.
   */
  unregisterPlugin(name: string): void;

  /** M33 — retained base-layer plugin records (for capabilities + reload). */
  listPluginRecords(): RegisteredPluginRecord[];

  /** All registered modules, regardless of activation. */
  listAvailable(): BackendModule[];

  /** Lookup including inactive — used for broken-chip categorisation. */
  getAvailable(type: string): BackendModule | null;

  /**
   * M15/M37: skills contributed by base-layer (workspace/npm) plugins — both
   * `contributes.skills` and the `contributes.writingStyles` sugar, already
   * lowered to one shape — collected during `registerPlugin`. Pushed into each
   * project's SkillRegistry as `source: "plugin"` at context build (project-local
   * overlay skills are pushed separately, behind the trust gate).
   */
  listSkills(): PluginSkillContribution[];

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
   * Stored as a thunk, not an instance: `buildMcpServers` calls it once per
   * `adapter.execute()`, so every SDK query gets a fresh `McpServer` — neither
   * concurrent turns nor successive queries of ONE turn may share an instance
   * (see the MountContext note). "Per turn" is precisely the granularity error
   * that let brief `0-2-23-to-next` survive; do not restate it that way.
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
   * once per `adapter.execute()` by the chat handler to wire the adapter — a
   * turn calls it more than once when the merged-dispatch queue drains. Each
   * call produces brand-new instances, so neither concurrent turns nor
   * successive queries of one turn collide on a shared transport.
   */
  buildMcpServers(): Array<{ name: string; server: McpServerFactory }>;

  /**
   * 0.2.13 — the type-specific operations of `:type`, read from the SAME factory
   * map `buildMcpServers()` builds from. This is what lets `GET /api/entities/
   * :type/tools` be a rendering of the plugin's one declaration rather than a
   * second list that drifts from it. A type with no custom operations answers
   * with an empty array — that is the normal case, not an error.
   */
  listTypeTools(type: string): readonly McpToolDeclaration[];

  /**
   * Invoke one of them. Calls the very handler the MCP channel calls and returns
   * its result unreshaped — the REST proxy is packing, not a second semantics.
   * `undefined` when the type declares no such tool, so the caller can answer
   * NOT_FOUND with the names it does declare.
   */
  callTypeTool(type: string, tool: string, args: Record<string, unknown>): Promise<unknown | undefined>;

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
  /**
   * The semantic delta, GENERATED from the type's `data.schema`.
   *
   * No longer "plugin-owned": 0.2.31 removed the `diff?` slot and the deep-diff
   * fallback with it, so there is one producer and one shape. `slug` is gone
   * from the signature because the delta no longer carries identity — the
   * caller pairs the two snapshots and owns which entity they belong to.
   */
  diff(type: string, a: SnapshotData, b: SnapshotData): EntityDiff;

  /** M31 dispose: drop per-project MCP factories so a retired context leaks nothing. */
  clearMcpFactories(): void;
}

/**
 * Back-compat alias — pre-M31 consumers typed against the singleton's
 * interface name. The per-project host is the only host shape now.
 */
export type PluginHost = ProjectPluginHost;

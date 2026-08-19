/**
 * M31: per-project plugin host. All mutable state that used to live in the
 * `pluginHost` singleton (activation sets, MCP factories, entity services)
 * is scoped to ONE ProjectContext — N projects in one process never share it.
 */

import type { Database } from 'better-sqlite3';
import type { McpServerFactory, McpToolDeclaration } from '../../../shared/plugin-host/mcp.js';
import type {
  BackendModule,
  EntityRenamedEvent,
  EntityServiceLike,
  MountContext,
  PluginRegistry,
  ProjectPluginHost,
  ProjectPluginOverlay,
  ShadowedType,
} from './types.js';
import type { PluginActivationState } from '../../../shared/plugin-host/types.js';
import type {
  PluginCommandContribution,
  PluginSettingsSection,
} from '../../../shared/plugin-host/manifest.js';
import type {
  EntityDiff,
  RestoreContext,
  RestoreResult,
  SnapshotData,
} from '../../serialization/types.js';
import { RawEntityReader } from '../../discovery/raw-entity-reader.js';
import { diffEntity, restoreEntity, snapshotEntity } from '../../serialization/snapshot.js';

/**
 * A factory handed back a server it had already handed back in the same
 * composition. Named, because the only useful report here is WHICH plugin —
 * the failure it prevents (an `McpServer` bound twice, tool results silently
 * gone for the whole mounted set) is invisible from the symptom.
 */
export class McpServerReuseError extends Error {
  constructor(
    message: string,
    /** The server name whose factory returned the repeat. */
    public readonly serverName: string,
  ) {
    super(message);
    this.name = 'McpServerReuseError';
  }
}

export class ProjectPluginHostImpl implements ProjectPluginHost {
  private activeTypes: Set<string> | null = null; // null = all active
  private unknownTypes: string[] = [];
  private mcpServerFactories = new Map<string, () => McpServerFactory>();
  private entityServices = new Map<string, unknown>();
  private renameListeners: Array<(ev: EntityRenamedEvent) => void> = [];
  /**
   * 2.0.0 — the index, for the questions a registered service used to be the only
   * way to ask. Wired post-construction (`consolidate` is a pure factory that
   * runs before the database exists) and optional: a host built by the CLI engine
   * or a test never gets one, and every consumer degrades to the service lookup
   * it used before.
   */
  private rawReader: RawEntityReader | null = null;
  setRawReader(reader: RawEntityReader): void {
    this.rawReader = reader;
  }
  // Project-local modules of THIS context, keyed by type. Empty when
  // `overlay === undefined` (parity with the base-only case).
  private readonly overlayModules = new Map<string, BackendModule>();

  constructor(
    private readonly registry: PluginRegistry,
    activeWhitelist: string[] | null | undefined,
    private readonly overlay?: ProjectPluginOverlay,
  ) {
    // Effective pool = base ∪ overlay. Overlay wins on cross-layer collision
    // (shadow) — `getAvailable`/`listAvailable` consult the overlay first.
    for (const m of overlay?.listLocal() ?? []) {
      this.overlayModules.set(m.type, m);
    }
    if (activeWhitelist == null) {
      this.activeTypes = null;
      this.unknownTypes = [];
      return;
    }
    // The whitelist is applied to the merged pool, not the base alone — an
    // overlay type is activatable exactly like a base type.
    const active = new Set<string>();
    const unknown: string[] = [];
    for (const type of activeWhitelist) {
      if (this.getAvailable(type)) active.add(type);
      else unknown.push(type);
    }
    this.activeTypes = active;
    this.unknownTypes = unknown;
  }

  listAvailable(): BackendModule[] {
    // Merge base + overlay; overlay shadows a same-typed base module.
    const merged = new Map<string, BackendModule>();
    for (const m of this.registry.listAvailable()) merged.set(m.type, m);
    for (const [type, m] of this.overlayModules) merged.set(type, m);
    return Array.from(merged.values()).sort((a, b) => a.displayOrder - b.displayOrder);
  }

  listEntities(): BackendModule[] {
    return this.listAvailable().filter((m) => this.isActive(m.type));
  }

  listSettings(): PluginSettingsSection[] {
    // Axis B (pool + trust), NOT axis A: deliberately unfiltered by
    // `config.entities`. Base records are always loaded+trusted; the overlay is
    // only constructed on the trusted path, so its sections are trusted too.
    // Overlay shadows base on a name collision (parity with type shadowing).
    const byName = new Map<string, PluginSettingsSection>();
    for (const r of this.registry.listPluginRecords()) {
      if (r.settings.length > 0) {
        byName.set(r.name, { name: r.name, version: r.version, fields: r.settings });
      }
    }
    for (const section of this.overlay?.listSettings() ?? []) {
      byName.set(section.name, section);
    }
    return Array.from(byName.values());
  }

  listCommands(): PluginCommandContribution[] {
    // Same two-axis rationale as listSettings(): pool + trust, not entities.
    const base = this.registry.listPluginRecords().flatMap((r) => r.commands);
    return [...base, ...(this.overlay?.listCommands() ?? [])];
  }

  getEntity(type: string): BackendModule | null {
    if (!this.isActive(type)) return null;
    return this.getAvailable(type);
  }

  getAvailable(type: string): BackendModule | null {
    // Overlay shadows base on cross-layer collision.
    return this.overlayModules.get(type) ?? this.registry.getAvailable(type) ?? null;
  }

  isActive(type: string): boolean {
    if (!this.getAvailable(type)) return false;
    if (this.activeTypes == null) return true;
    return this.activeTypes.has(type);
  }

  partition(): PluginActivationState {
    const active = this.listEntities().map((m) => m.type);
    const inactive = this.listAvailable()
      .filter((m) => !this.isActive(m.type))
      .map((m) => m.type);
    return { active, inactive, unknown: [...this.unknownTypes] };
  }

  shadowReport(): ShadowedType[] {
    const out: ShadowedType[] = [];
    for (const type of this.overlayModules.keys()) {
      // Cross-layer collision: the overlay type also exists in the base layer.
      if (this.registry.getAvailable(type)) {
        out.push({ type, overlayOrigin: this.overlay?.origin(type) ?? '' });
      }
    }
    return out;
  }

  /**
   * Host API 2.0.0 — `mountBackend` runs NO migrations.
   *
   * It used to run each module's `backend.migrations` before mounting it, in two
   * passes over different sets, with a warn-and-continue arm for deactivated
   * types whose DDL would not apply. All of that is gone: there is no
   * per-plugin migration chain and no `plugin_schema_migrations` ledger. Tables
   * come from `applyProjection`, generated from `data.schema` at ProjectContext
   * construction, before this method and before `indexAll()`.
   *
   * The properties that machinery existed to provide are now structural rather
   * than sequenced:
   *   - the projection covers every AVAILABLE type, not just active ones, so a
   *     deactivated type still has its (empty) table and `GET /entities/counts`
   *     cannot 500 on a missing one;
   *   - creating every table before mounting anything is what it always was, but
   *     now it is one call rather than an ordering constraint between passes;
   *   - a schema that "will not apply" no longer exists as a failure mode. The
   *     generator only CREATEs and ADDs COLUMNs; anything more is the rebuild's
   *     job, and the rebuild reads files, which always apply.
   *
   * A throwing mount still propagates — M31 turns it into a per-project build
   * failure (500 PROJECT_BUILD_FAILED), never a process crash.
   */
  mountBackend(ctx: MountContext): void {
    for (const m of this.listEntities()) m.backend?.mount?.(ctx);
  }

  registerMcpServer(name: string, factory: () => McpServerFactory): void {
    this.mcpServerFactories.set(name, factory);
  }

  registerRenameListener(fn: (ev: EntityRenamedEvent) => void): void {
    this.renameListeners.push(fn);
  }

  listRenameListeners(): Array<(ev: EntityRenamedEvent) => void> {
    return [...this.renameListeners];
  }

  /**
   * Builds one fresh server per registered factory. Every entry is validated
   * before it leaves this method: the caller (`runAgentTurn`) reads `.config`
   * off each result straight into the adapter's `mcpServers` map, and a single
   * malformed entry lands there as `undefined` — the adapter then dies on
   * `serverConfig.type` and takes down EVERY turn in EVERY project of the
   * workspace, not just the offending type. One broken plugin must degrade to
   * "its tools are missing", never to "chat is dead".
   *
   * This is the single choke point for that check on purpose: it covers both
   * the declarative `backend.mcpServer` slot (wrapped in `synthesizeMount`) and
   * a plugin's own `mount()` calling `registerMcpServer` directly — the latter
   * bypasses `manifest-adapter` entirely, which is exactly how a hand-rolled
   * `{name, version, tools}` descriptor reached the adapter in the wild.
   *
   * "Fresh" is enforced, not assumed — and THAT failure is fatal, unlike every
   * other one here. A factory that memoizes its handle hands the same
   * `McpServer` to two `adapter.execute` calls, and an `McpServer` binds to
   * exactly one transport: the second `connect()` rejects with 'Already
   * connected to a transport', the SDK swallows the rejection into a debug log
   * and STILL advertises the server, and `_onclose` aborts the in-flight
   * handlers of the first binding. The damage is not confined to the offending
   * plugin — the whole map shares one execute, so `brief-tools` goes dark
   * alongside it, and the symptom is a tool call that returns no `tool_result`
   * at all. Degrading to "its tools are missing" is the right posture for a
   * broken plugin; it is the WRONG posture for a plugin that silently breaks
   * everyone else's tools, which is why this one throws.
   */
  buildMcpServers(): Array<{ name: string; server: McpServerFactory }> {
    const out: Array<{ name: string; server: McpServerFactory }> = [];
    // Identity, not equality: two structurally identical handles built by two
    // `createMcpServer` calls are fine — the same object twice is not.
    const seenHandles = new Set<object>();
    const seenInstances = new Set<object>();
    for (const [name, factory] of this.mcpServerFactories) {
      let server: unknown;
      try {
        server = factory();
      } catch (err) {
        console.warn(
          `[plugin-host] MCP server "${name}" — factory threw, skipping this server for the turn: ` +
            `${(err as Error).message}`,
        );
        continue;
      }
      // Backward-compat shim: a plugin built against the pre-0.1.133 contract
      // returns `() => McpServerFactory` (a thunk) instead of the handle.
      // A server handle is always a plain `{server, config}` object,
      // never callable, so `typeof === 'function'` identifies the old shape
      // unambiguously.
      if (typeof server === 'function') {
        console.warn(
          `[plugin-host] MCP server "${name}" returned a thunk (pre-0.1.133 contract) — ` +
            `auto-unwrapping for compatibility. Migrate this plugin to return the McpServerFactory handle directly.`,
        );
        try {
          server = (server as () => unknown)();
        } catch (err) {
          console.warn(
            `[plugin-host] MCP server "${name}" — unwrapped thunk threw, skipping: ${(err as Error).message}`,
          );
          continue;
        }
      }
      if (
        typeof server !== 'object' ||
        server === null ||
        (server as { config?: unknown }).config == null
      ) {
        console.warn(
          `[plugin-host] MCP server "${name}" — factory returned a value without a usable \`config\`, skipping. ` +
            `A backend MCP server must be built with \`createMcpServer(...)\` from the plugin runtime facade; ` +
            `a hand-rolled descriptor (e.g. \`{name, version, tools}\`) is NOT a valid McpServerFactory.`,
        );
        continue;
      }
      const handle = server as McpServerFactory & { server?: unknown };
      const instance = (handle.config as { instance?: unknown } | undefined)?.instance;
      if (seenHandles.has(handle)) {
        throw new McpServerReuseError(
          `[plugin-host] MCP server "${name}" — factory returned an instance already returned ` +
            `for another server in this composition. Each factory must build a FRESH server per ` +
            `call (an McpServer binds to exactly one transport; a shared instance silently kills ` +
            `tool results for the whole mounted set). Fix the plugin to stop memoizing its handle.`,
          name,
        );
      }
      if (instance != null && typeof instance === 'object') {
        if (seenInstances.has(instance)) {
          throw new McpServerReuseError(
            `[plugin-host] MCP server "${name}" — factory returned an McpServer instance already ` +
              `mounted under a different name in this composition. Each factory must build a FRESH ` +
              `server per call (an McpServer binds to exactly one transport; a shared instance ` +
              `silently kills tool results for the whole mounted set).`,
            name,
          );
        }
        seenInstances.add(instance);
      }
      seenHandles.add(handle);
      out.push({ name, server: handle as McpServerFactory });
    }
    return out;
  }

  clearMcpFactories(): void {
    this.mcpServerFactories.clear();
  }

  /**
   * 0.2.13 — the type-specific operations a plugin declared in its
   * `backend.mcpServer` slot, as the host itself sees them.
   *
   * Reads `mcpServerFactories` — literally the map `buildMcpServers()` iterates —
   * so `GET /api/entities/:type/tools` and the MCP mount cannot disagree about
   * what a type can do. Deactivating a type through `config.entities` removes it
   * from `listEntities()`, `mountBackend` never registers its server, and the
   * operation disappears from BOTH renderings in the same breath. That is the
   * property being bought here; a separately-maintained list would not have it.
   *
   * The `${type}-tools` key is not a convention this method invented — it is
   * where `manifest-adapter` lowers the declarative slot, deriving the server
   * name from the type id rather than letting the plugin choose it.
   *
   * A type with no custom operations answers with an EMPTY LIST, not an error: a
   * plugin declaring no extra tools is the normal case (`dto`, `ui-view`,
   * `design-system` all do), not a misconfiguration.
   */
  listTypeTools(type: string): readonly McpToolDeclaration[] {
    const factory = this.mcpServerFactories.get(`${type}-tools`);
    if (!factory) return [];
    let server: unknown;
    try {
      server = factory();
    } catch (err) {
      // Same posture as buildMcpServers(): one broken plugin degrades to "its
      // tools are missing", never to a 500 on a route about a different type.
      console.warn(
        `[plugin-host] MCP server "${type}-tools" — factory threw while listing tools: ${(err as Error).message}`,
      );
      return [];
    }
    const tools = (server as { tools?: readonly McpToolDeclaration[] } | null)?.tools;
    return tools ?? [];
  }

  /**
   * Invoke one type-specific operation. The REST proxy is a PACKING layer, not a
   * second semantics: this calls the very handler the MCP channel calls, with
   * arguments validated by the very schema MCP validates against, and returns
   * its result unreshaped.
   *
   * Returns `undefined` when the type declares no such tool, so the caller can
   * answer `NOT_FOUND` with the list of the ones it does declare.
   */
  async callTypeTool(type: string, tool: string, args: Record<string, unknown>): Promise<unknown | undefined> {
    const found = this.listTypeTools(type).find((t) => t.name === tool);
    if (!found) return undefined;
    return found.handler(args, {});
  }

  entityExists(type: string, slug: string): boolean {
    // M29: slug is the sole identity. Prefer the registered entity service —
    // it may resolve an entity the raw row cannot express — and fall back to the
    // generated projection.
    //
    // 2.0.0: the fallback is the point. "Every active type exposes getBySlug"
    // stopped being true the moment a type could declare `data.schema` and ship
    // no `backend.service`, and this method answered `false` for those — so a
    // page's `<inline_mention/>` was never linked into `section_entity`, the
    // reference tools returned NOT_FOUND, and an AC verifying such an entity was
    // reported broken. All from one existence check, for an entity sitting in its
    // table the whole time.
    const service = this.entityServices.get(type) as
      | { getBySlug?: (slug: string) => unknown }
      | undefined;
    if (service?.getBySlug) return service.getBySlug(slug) != null;
    return this.rawReader?.getEntity(type, slug) != null;
  }

  registerEntityService(type: string, service: unknown): void {
    this.entityServices.set(type, service);
  }

  /**
   * 0.2.2 — the ONE door to a type's service. `null` covers both "inactive in
   * this project" and "contributed no `backend.service` slot"; callers that can
   * legitimately continue without a write door (restore) report a skip, callers
   * for which absence is a bug use `requireService`.
   *
   * The stored value is cast, not validated: `EntityServiceLike` is `Partial` on
   * both halves, so every registered service satisfies it structurally and the
   * caller narrows by probing the method it actually needs.
   */
  getEntityService(type: string): EntityServiceLike | null {
    if (!this.isActive(type)) return null;
    return (this.entityServices.get(type) as EntityServiceLike | undefined) ?? null;
  }

  requireService(type: string): EntityServiceLike {
    const service = this.getEntityService(type);
    if (!service) throw new Error(`entity service for type '${type}' not registered`);
    return service;
  }

  // ─── M17 snapshot helpers ────────────────────────────────────────────────

  snapshot(type: string, entity: unknown, reader: RawEntityReader): SnapshotData {
    return snapshotEntity(this, type, entity, reader);
  }

  restore(type: string, data: SnapshotData, ctx: RestoreContext): RestoreResult {
    return restoreEntity(this, type, data, ctx);
  }

  diff(type: string, a: SnapshotData, b: SnapshotData): EntityDiff {
    return diffEntity(this, type, a, b);
  }

  /**
   * One reader per database handle. `count()` memoizes table existence, so
   * rebuilding it every turn would re-probe `sqlite_master` for each type; and
   * a project context owns exactly one handle, so the map holds one entry.
   */
  private readonly counters = new WeakMap<Database, RawEntityReader>();

  private readerFor(db: Database): RawEntityReader {
    let reader = this.counters.get(db);
    if (!reader) {
      reader = new RawEntityReader(db, this);
      this.counters.set(db, reader);
    }
    return reader;
  }

  computeEntityCounts(db: Database): Record<string, number> {
    // 2.0.0: the host counts, and a type that wants a subset declares
    // `systemPrompt.defaultPredicate` — data the host evaluates, never SQL it
    // executes. 0.2.4 closed the raw-SQL surface but had no replacement, so
    // `ac` lost its `status='active'` filter along the way; this restores it
    // through the ONE call both the sidebar and the `<project>` block make, so
    // the agent and the user cannot see different numbers for the same type.
    const reader = this.readerFor(db);
    const counts: Record<string, number> = {};
    for (const m of this.listEntities()) {
      counts[m.type] = reader.count(m.type);
    }
    return counts;
  }
}

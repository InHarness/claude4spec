/**
 * M31: per-project plugin host. All mutable state that used to live in the
 * `pluginHost` singleton (activation sets, MCP factories, entity services)
 * is scoped to ONE ProjectContext — N projects in one process never share it.
 */

import type { Database } from 'better-sqlite3';
import type { McpServerFactory } from '../../../shared/plugin-host/mcp.js';
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
  SerializeContext,
  SnapshotData,
} from '../../serialization/types.js';
import { diffEntity, restoreEntity, snapshotEntity } from '../../serialization/snapshot.js';
import { runPluginMigrations } from './plugin-migrate.js';

export class ProjectPluginHostImpl implements ProjectPluginHost {
  private activeTypes: Set<string> | null = null; // null = all active
  private unknownTypes: string[] = [];
  private mcpServerFactories = new Map<string, () => McpServerFactory>();
  private entityServices = new Map<string, unknown>();
  private renameListeners: Array<(ev: EntityRenamedEvent) => void> = [];
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

  mountBackend(ctx: MountContext): void {
    // A throwing plugin migration/mount propagates — M31 turns it into a
    // per-project build failure (500 PROJECT_BUILD_FAILED), never a process
    // crash. L1 (M13): the host runs each plugin's declared `backend.migrations`
    // (schema_version per plugin, idempotent) BEFORE its mount, so the entity
    // table exists by the time `mount` builds its service and the first query runs.
    //
    // 0.2.2 Tier B: TWO passes, over DIFFERENT sets.
    //
    // MIGRATE every AVAILABLE module — including deactivated ones. The schema is
    // a function of what is INSTALLED, not of what is enabled. That was true
    // before this release for free, because entity DDL sat in the host chain and
    // ran unconditionally; migrating only active modules quietly changed it, and
    // any host code that walks all available types then hit a missing table.
    // `GET /entities/counts` did exactly that and returned 500 for the whole
    // sidebar because one deactivated type had no table. A deactivated type
    // keeps an empty table, exactly as it always did.
    //
    // MOUNT only the ACTIVE ones: a deactivated type contributes no service, no
    // routes and no tools. That half is unchanged.
    //
    // Migrations run before ANY mount, not interleaved per module. A module's
    // table may be referenced by another module's schema — `endpoint_dto`
    // carries an FK to `dto(slug)` — and this iterates in `displayOrder`, not
    // `dependsOn` order, so interleaving would make correctness depend on two
    // unrelated numbers lining up. It also means no mount can observe a
    // half-migrated schema.
    for (const m of this.listAvailable()) runPluginMigrations(ctx.db, m.type, m.backend?.migrations);
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
   */
  buildMcpServers(): Array<{ name: string; server: McpServerFactory }> {
    const out: Array<{ name: string; server: McpServerFactory }> = [];
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
      out.push({ name, server: server as McpServerFactory });
    }
    return out;
  }

  clearMcpFactories(): void {
    this.mcpServerFactories.clear();
  }

  entityExists(type: string, slug: string): boolean {
    // M29: slug is the sole identity. Existence is a slug lookup via the
    // registered entity service (every active type exposes getBySlug).
    const service = this.entityServices.get(type) as
      | { getBySlug?: (slug: string) => unknown }
      | undefined;
    return service?.getBySlug ? service.getBySlug(slug) != null : false;
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

  snapshot(type: string, entity: unknown, ctx: SerializeContext): SnapshotData {
    return snapshotEntity(this, type, entity, ctx);
  }

  restore(type: string, data: SnapshotData, ctx: RestoreContext): RestoreResult {
    return restoreEntity(this, type, data, ctx);
  }

  diff(type: string, a: SnapshotData, b: SnapshotData, slug: string): EntityDiff {
    return diffEntity(this, type, a, b, slug);
  }

  computeEntityCounts(db: Database): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const m of this.listEntities()) {
      const sql = m.systemPrompt.countStat.sqlQuery;
      if (!sql) continue;
      try {
        const row = db.prepare(sql).get() as { count?: number } | undefined;
        counts[m.type] = row?.count ?? 0;
      } catch (err) {
        console.warn(
          `[plugin-host] computeEntityCounts: countStat query failed for type=${m.type}: ${(err as Error).message}`,
        );
        counts[m.type] = 0;
      }
    }
    return counts;
  }
}

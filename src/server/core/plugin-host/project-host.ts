/**
 * M31: per-project plugin host. All mutable state that used to live in the
 * `pluginHost` singleton (activation sets, MCP factories, entity services)
 * is scoped to ONE ProjectContext — N projects in one process never share it.
 */

import type { Database } from 'better-sqlite3';
import type { McpServerInstance } from '@inharness-ai/agent-adapters';
import type {
  BackendModule,
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
  private mcpServerFactories = new Map<string, () => McpServerInstance>();
  private entityServices = new Map<string, unknown>();
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
    for (const m of this.listEntities()) {
      runPluginMigrations(ctx.db, m.type, m.backend?.migrations);
      m.backend?.mount?.(ctx);
    }
  }

  registerMcpServer(name: string, factory: () => McpServerInstance): void {
    this.mcpServerFactories.set(name, factory);
  }

  buildMcpServers(): Array<{ name: string; server: McpServerInstance }> {
    return Array.from(this.mcpServerFactories.entries()).map(([name, factory]) => ({
      name,
      server: factory(),
    }));
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

  getEntityService(type: string): unknown {
    return this.entityServices.get(type) ?? null;
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

/**
 * Server PluginHost — singleton holding registered BackendModule manifests +
 * activation state. M13 spec: this is the *single* abstraction layer for
 * entity types. All consumers (chat-context, serializer registry, MCP, L4
 * routes) ask the host instead of iterating type literals.
 *
 * Phase 0: only registration + lookup. mountBackend is a stub that becomes
 * the unified mount point in Phase 3.
 */

import type { Database } from 'better-sqlite3';
import type { McpServerInstance } from '@inharness-ai/agent-adapters';
import type {
  BackendModule,
  MountContext,
  PluginHost,
} from './types.js';
import type { PluginActivationState } from '../../../shared/plugin-host/types.js';
import type {
  EntityDiff,
  RestoreContext,
  RestoreResult,
  SerializeContext,
  SnapshotData,
} from '../../serialization/types.js';
import { diffEntity, restoreEntity, snapshotEntity } from '../../serialization/snapshot.js';

class PluginHostImpl implements PluginHost {
  private modules = new Map<string, BackendModule>();
  private activeTypes: Set<string> | null = null; // null = all active
  private unknownTypes: string[] = [];
  private mcpServerFactories = new Map<string, () => McpServerInstance>();
  private entityServices = new Map<string, unknown>();

  registerBackendModule(module: BackendModule): void {
    if (!module.type) {
      throw new Error('plugin-host: module.type is required');
    }
    this.modules.set(module.type, module);
  }

  consolidate(activeWhitelist: string[] | null | undefined): void {
    if (activeWhitelist == null) {
      this.activeTypes = null;
      this.unknownTypes = [];
      return;
    }
    const active = new Set<string>();
    const unknown: string[] = [];
    for (const type of activeWhitelist) {
      if (this.modules.has(type)) active.add(type);
      else unknown.push(type);
    }
    this.activeTypes = active;
    this.unknownTypes = unknown;
  }

  listAvailable(): BackendModule[] {
    return Array.from(this.modules.values()).sort(
      (a, b) => a.displayOrder - b.displayOrder
    );
  }

  listEntities(): BackendModule[] {
    return this.listAvailable().filter((m) => this.isActive(m.type));
  }

  getEntity(type: string): BackendModule | null {
    if (!this.isActive(type)) return null;
    return this.modules.get(type) ?? null;
  }

  getAvailable(type: string): BackendModule | null {
    return this.modules.get(type) ?? null;
  }

  isActive(type: string): boolean {
    if (!this.modules.has(type)) return false;
    if (this.activeTypes == null) return true;
    return this.activeTypes.has(type);
  }

  state(): PluginActivationState {
    const active = this.listEntities().map((m) => m.type);
    const inactive = this.listAvailable()
      .filter((m) => !this.isActive(m.type))
      .map((m) => m.type);
    return { active, inactive, unknown: [...this.unknownTypes] };
  }

  mountBackend(ctx: MountContext): void {
    for (const m of this.listEntities()) {
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

export const pluginHost: PluginHost = new PluginHostImpl();

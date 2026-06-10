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

export class ProjectPluginHostImpl implements ProjectPluginHost {
  private activeTypes: Set<string> | null = null; // null = all active
  private unknownTypes: string[] = [];
  private mcpServerFactories = new Map<string, () => McpServerInstance>();
  private entityServices = new Map<string, unknown>();

  constructor(
    private readonly registry: PluginRegistry,
    activeWhitelist: string[] | null | undefined,
  ) {
    if (activeWhitelist == null) {
      this.activeTypes = null;
      this.unknownTypes = [];
      return;
    }
    const active = new Set<string>();
    const unknown: string[] = [];
    for (const type of activeWhitelist) {
      if (this.registry.getAvailable(type)) active.add(type);
      else unknown.push(type);
    }
    this.activeTypes = active;
    this.unknownTypes = unknown;
  }

  listAvailable(): BackendModule[] {
    return this.registry.listAvailable();
  }

  listEntities(): BackendModule[] {
    return this.listAvailable().filter((m) => this.isActive(m.type));
  }

  getEntity(type: string): BackendModule | null {
    if (!this.isActive(type)) return null;
    return this.registry.getAvailable(type);
  }

  getAvailable(type: string): BackendModule | null {
    return this.registry.getAvailable(type);
  }

  isActive(type: string): boolean {
    if (!this.registry.getAvailable(type)) return false;
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

  mountBackend(ctx: MountContext): void {
    // A throwing plugin mount propagates — M31 turns it into a per-project
    // build failure (500 PROJECT_BUILD_FAILED), never a process crash.
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

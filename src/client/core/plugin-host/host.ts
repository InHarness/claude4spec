/**
 * Client-side PluginHost — singleton holding registered FrontendModule
 * manifests + activation state seeded from GET /api/_meta/entities.
 *
 * Phase 0: applyActivation has no effect because legacy callers still iterate
 * the old entity registry directly. Phase 1 wires the diagnostic endpoint;
 * Phase 4+ migrates consumers to ask the host.
 */

import type { ClientPluginHost, FrontendModule } from './types.js';
import type { PluginActivationState } from '../../../shared/plugin-host/types.js';

/**
 * Categorisation for broken chip rendering (M13 Phase 5):
 *   - 'active'           — host.getEntity(type) succeeded; entity may still be missing.
 *   - 'inactive-plugin'  — type registered but not active in current config.entities.
 *   - 'unknown-type'     — type never registered (typo, removed plugin, ...).
 */
export type ChipBrokenCategory = 'inactive-plugin' | 'unknown-type';

class ClientPluginHostImpl implements ClientPluginHost {
  private modules = new Map<string, FrontendModule>();
  private activeTypes: Set<string> | null = null; // null = all active

  registerFrontendModule(module: FrontendModule): void {
    if (!module.type) {
      throw new Error('client plugin-host: module.type is required');
    }
    this.modules.set(module.type, module);
  }

  applyActivation(state: PluginActivationState | null): void {
    if (state == null) {
      this.activeTypes = null;
      return;
    }
    this.activeTypes = new Set(state.active);
  }

  listAvailable(): FrontendModule[] {
    return Array.from(this.modules.values()).sort(
      (a, b) => a.displayOrder - b.displayOrder
    );
  }

  listEntities(): FrontendModule[] {
    return this.listAvailable().filter((m) => this.isActive(m.type));
  }

  getEntity(type: string): FrontendModule | null {
    if (!this.isActive(type)) return null;
    return this.modules.get(type) ?? null;
  }

  getAvailable(type: string): FrontendModule | null {
    return this.modules.get(type) ?? null;
  }

  isActive(type: string): boolean {
    if (!this.modules.has(type)) return false;
    if (this.activeTypes == null) return true;
    return this.activeTypes.has(type);
  }
}

export const clientPluginHost: ClientPluginHost = new ClientPluginHostImpl();

/**
 * Categorise a chip's broken state. Returns null when the type is active
 * (caller should render normal chip and treat missing entity row as
 * 'broken-reference' separately).
 */
export function categoriseBrokenChip(type: string): ChipBrokenCategory | null {
  if (clientPluginHost.getEntity(type)) return null;
  if (clientPluginHost.getAvailable(type)) return 'inactive-plugin';
  return 'unknown-type';
}

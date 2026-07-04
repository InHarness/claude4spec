/**
 * Client-side PluginHost — singleton holding registered FrontendModule
 * manifests + activation state seeded from GET /api/_meta/entities.
 *
 * Phase 0: applyActivation has no effect because legacy callers still iterate
 * the old entity registry directly. Phase 1 wires the diagnostic endpoint;
 * Phase 4+ migrates consumers to ask the host.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClientPluginHost, FrontendModule } from './types.js';
import type { PluginActivationState } from '../../../shared/plugin-host/types.js';

/**
 * Categorisation for broken chip rendering (M13 Phase 5):
 *   - 'active'           — host.getEntity(type) succeeded; entity may still be missing.
 *   - 'inactive-plugin'  — type registered but not active in current config.entities.
 *   - 'unknown-type'     — type never registered (typo, removed plugin, ...).
 */
export type ChipBrokenCategory = 'inactive-plugin' | 'unknown-type';

const REQUIRED_COMPONENT_SLOTS = ['renderChip', 'renderCard', 'renderRow', 'detailPanel'] as const;
const REQUIRED_FUNCTION_SLOTS = ['useGetBySlug', 'listByTags'] as const;

/**
 * M34/L11: validate a module's slot SHAPES at registration time — catches a
 * missing/mistyped slot (e.g. a plugin author's typo) before it fails deep
 * inside a render pass with a confusing stack.
 */
function assertSlotShapes(module: FrontendModule): void {
  for (const slot of REQUIRED_COMPONENT_SLOTS) {
    if (typeof module[slot] !== 'function') {
      throw new Error(`client plugin-host: module '${module.type}' — '${slot}' must be a React component`);
    }
  }
  for (const slot of REQUIRED_FUNCTION_SLOTS) {
    if (typeof module[slot] !== 'function') {
      throw new Error(`client plugin-host: module '${module.type}' — '${slot}' must be a function`);
    }
  }
}

/**
 * M34/L11: pure-React smoke test of the chip renderer — catches a
 * synchronously-throwing `renderChip` at REGISTRATION time instead of
 * deferring the crash to the first inline mention actually rendered, which
 * (pre-M34) could take down the whole page. `entity: null` is the documented
 * broken-reference case every chip must already handle (see
 * `EntityChipProps`), so it's the natural minimal smoke-test prop.
 */
function smokeTestChip(module: FrontendModule): void {
  try {
    renderToStaticMarkup(createElement(module.renderChip, { slug: '__smoke_test__', entity: null }));
  } catch (err) {
    throw new Error(
      `client plugin-host: module '${module.type}' — renderChip threw during load-time smoke test: ${(err as Error).message}`,
    );
  }
}

class ClientPluginHostImpl implements ClientPluginHost {
  private modules = new Map<string, FrontendModule>();
  private activeTypes: Set<string> | null = null; // null = all active

  registerFrontendModule(module: FrontendModule): void {
    if (!module.type) {
      throw new Error('client plugin-host: module.type is required');
    }
    assertSlotShapes(module);
    smokeTestChip(module);
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
 * Free-function form of `clientPluginHost.registerFrontendModule`, re-exported
 * through `@c4s/plugin-runtime` so a runtime plugin can hand its frontend slots
 * to the host without reaching into the singleton directly.
 */
export function registerFrontendModule(module: FrontendModule): void {
  clientPluginHost.registerFrontendModule(module);
}

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

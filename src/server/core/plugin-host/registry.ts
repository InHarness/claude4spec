/**
 * M31: process-level plugin catalog. Replaces the mutable `pluginHost`
 * singleton — the registry is immutable after `registerAllPlugins(registry)`
 * runs at process start, and `consolidate(config.entities)` is a pure factory
 * producing one ProjectPluginHost per project context.
 */

import type { BackendModule, PluginRegistry, ProjectPluginHost } from './types.js';
import { ProjectPluginHostImpl } from './project-host.js';

export class PluginRegistryImpl implements PluginRegistry {
  private modules = new Map<string, BackendModule>();

  registerEntityModule(module: BackendModule): void {
    if (!module.type) {
      throw new Error('plugin-registry: module.type is required');
    }
    this.modules.set(module.type, module);
  }

  listAvailable(): BackendModule[] {
    return Array.from(this.modules.values()).sort(
      (a, b) => a.displayOrder - b.displayOrder
    );
  }

  getAvailable(type: string): BackendModule | null {
    return this.modules.get(type) ?? null;
  }

  consolidate(activeWhitelist: string[] | null | undefined): ProjectPluginHost {
    return new ProjectPluginHostImpl(this, activeWhitelist);
  }
}

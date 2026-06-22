/**
 * M31: process-level plugin catalog. Replaces the mutable `pluginHost`
 * singleton — the registry is immutable after `registerAllPlugins(registry)`
 * runs at process start, and `consolidate(config.entities)` is a pure factory
 * producing one ProjectPluginHost per project context.
 */

import type { BackendModule, PluginRegistry, ProjectPluginHost } from './types.js';
import type { PluginManifest } from '../../../shared/plugin-host/manifest.js';
import { ProjectPluginHostImpl } from './project-host.js';
import { PluginManifestError, lowerEntityContribution } from './manifest-adapter.js';

export class PluginRegistryImpl implements PluginRegistry {
  private modules = new Map<string, BackendModule>();

  registerEntityModule(module: BackendModule): void {
    if (!module.type) {
      throw new Error('plugin-registry: module.type is required');
    }
    this.modules.set(module.type, module);
  }

  registerPlugin(manifest: PluginManifest): void {
    if (!manifest || typeof manifest !== 'object') {
      throw new PluginManifestError('plugin manifest must be an object');
    }
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new PluginManifestError('plugin manifest requires string name + version');
    }
    if (manifest.contributes == null || typeof manifest.contributes !== 'object') {
      throw new PluginManifestError(`plugin "${manifest.name}" — contributes must be an object`);
    }
    for (const contribution of manifest.contributes.entities ?? []) {
      this.registerEntityModule(lowerEntityContribution(contribution));
    }
    // contributes.writingStyles is declared but ignored until phase 2.
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

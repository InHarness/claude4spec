/**
 * M31: process-level plugin catalog. Replaces the mutable `pluginHost`
 * singleton — the registry is immutable after `registerAllPlugins(registry)`
 * runs at process start, and `consolidate(config.entities)` is a pure factory
 * producing one ProjectPluginHost per project context.
 */

import type {
  BackendModule,
  PluginRegistry,
  ProjectPluginHost,
  ProjectPluginOverlay,
} from './types.js';
import type {
  PluginManifest,
  WritingStyleContribution,
} from '../../../shared/plugin-host/manifest.js';
import { ProjectPluginHostImpl } from './project-host.js';
import {
  PluginManifestError,
  lowerEntityContribution,
  validateWritingStyle,
} from './manifest-adapter.js';

export class PluginRegistryImpl implements PluginRegistry {
  private modules = new Map<string, BackendModule>();
  // M15 phase 2: base-layer plugin writing styles, in registration order.
  private writingStyles: WritingStyleContribution[] = [];

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
    // Two-pass for atomicity: lower (validate) every contribution first, so a
    // throw on a later entity/style never leaves earlier ones registered under a
    // manifest the loader then reports as failed.
    const modules = (manifest.contributes.entities ?? []).map(lowerEntityContribution);
    const styles = (manifest.contributes.writingStyles ?? []).map(validateWritingStyle);
    for (const module of modules) {
      this.registerEntityModule(module);
    }
    // M15 phase 2: collect styles to push into each project's SkillRegistry.
    this.writingStyles.push(...styles);
  }

  listWritingStyles(): WritingStyleContribution[] {
    return [...this.writingStyles];
  }

  listAvailable(): BackendModule[] {
    return Array.from(this.modules.values()).sort(
      (a, b) => a.displayOrder - b.displayOrder
    );
  }

  getAvailable(type: string): BackendModule | null {
    return this.modules.get(type) ?? null;
  }

  consolidate(
    config: { entities?: string[] } | null | undefined,
    overlay?: ProjectPluginOverlay,
  ): ProjectPluginHost {
    return new ProjectPluginHostImpl(this, config?.entities, overlay);
  }
}

import { SerializationEngine } from './serialization-engine.js';
import { PluginRegistryImpl } from './registry.js';
import { registerAllPlugins } from '../../serialization/registerAll.js';
import { sectionSerializer } from '../../serialization/serializers/section.js';
import { loadWorkspacePlugins } from './loader.js';

/**
 * M31/M33: per-process L9 engine for the read-only CLI (`c4s`, `c4s-mcp`). The
 * CLI never applies a project's `entities` whitelist (parity with the
 * pre-split singleton, whose `consolidate` was never invoked in CLI
 * processes — all plugins active).
 *
 * This sync form registers the in-host built-ins only. Use
 * {@link buildCliSerializationEngineAsync} when a resolved workspace may carry
 * plugin packages, so the CLI sees plugin-borne entity types exactly as the
 * server does (no separate CLI registration path).
 */
export function buildCliSerializationEngine(): SerializationEngine {
  const pluginRegistry = new PluginRegistryImpl();
  registerAllPlugins(pluginRegistry);
  return new SerializationEngine(pluginRegistry.consolidate(undefined), sectionSerializer);
}

/**
 * M33: build the CLI engine after running the shared bootstrap loader, so
 * workspace-declared plugin packages contribute their entity types to L9
 * serialization identically to the server. `packageNames` empty ⇒ built-ins
 * only (identical output to the sync form).
 */
export async function buildCliSerializationEngineAsync(
  packageNames: string[],
): Promise<SerializationEngine> {
  const pluginRegistry = new PluginRegistryImpl();
  registerAllPlugins(pluginRegistry);
  await loadWorkspacePlugins(pluginRegistry, packageNames);
  return new SerializationEngine(pluginRegistry.consolidate(undefined), sectionSerializer);
}

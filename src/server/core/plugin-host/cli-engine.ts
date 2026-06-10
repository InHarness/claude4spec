import { SerializationEngine } from './serialization-engine.js';
import { PluginRegistryImpl } from './registry.js';
import { registerAllPlugins } from '../../serialization/registerAll.js';
import { sectionSerializer } from '../../serialization/serializers/section.js';

/**
 * M31: per-process L9 engine for the read-only CLI (`c4s`, `c4s-mcp`). The
 * CLI never applies a project's `entities` whitelist (parity with the
 * pre-split singleton, whose `consolidate` was never invoked in CLI
 * processes — all plugins active).
 */
export function buildCliSerializationEngine(): SerializationEngine {
  const pluginRegistry = new PluginRegistryImpl();
  registerAllPlugins(pluginRegistry);
  return new SerializationEngine(pluginRegistry.consolidate(undefined), sectionSerializer);
}

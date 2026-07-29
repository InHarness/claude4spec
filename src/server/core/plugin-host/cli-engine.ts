import { SerializationEngine } from './serialization-engine.js';
import { PluginRegistryImpl } from './registry.js';
import { registerAllPlugins } from '../../serialization/registerAll.js';
import { sectionSerializer } from '../../serialization/serializers/section.js';
import { loadBuiltinEnvelopes, loadWorkspacePlugins } from './loader.js';

/**
 * M31/M33: per-process L9 engine for the read-only CLI (`c4s`, `c4s-mcp`). The
 * CLI never applies a project's `entities` whitelist (parity with the
 * pre-split singleton, whose `consolidate` was never invoked in CLI
 * processes — all plugins active).
 *
 * Build the engine after running the shared bootstrap loader, so
 * workspace-declared plugin packages contribute their entity types to L9
 * serialization identically to the server (no separate CLI registration path).
 * `packageNames` empty ⇒ built-ins only.
 */
export async function buildCliSerializationEngineAsync(
  packageNames: string[],
): Promise<SerializationEngine> {
  const pluginRegistry = new PluginRegistryImpl();
  registerAllPlugins(pluginRegistry);
  // 0.2.2 — tier (b) FIRST: built-in envelopes from `<hostRoot>/plugins/*` register
  // before node_modules and before the workspace registry, so core code claims its
  // types before anything external could shadow them. No-op until the first envelope
  // lands (Tier B of the 0.2.2 brief).
  await loadBuiltinEnvelopes(pluginRegistry);
  await loadWorkspacePlugins(pluginRegistry, packageNames);
  // CLI applies no whitelist and no project-local overlay (read-only parity).
  return new SerializationEngine(pluginRegistry.consolidate({}), sectionSerializer);
}

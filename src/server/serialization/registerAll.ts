import type { PluginRegistry } from '../core/plugin-host/types.js';
import { onRegister as registerUiView } from '../entities/ui-view/plugin.js';
import { onRegister as registerAc } from '../entities/ac/plugin.js';
import { onRegister as registerDesignSystem } from '../entities/design-system/plugin.js';
import { onRegister as registerDiagram } from '../entities/diagram/plugin.js';

/**
 * M31: replaces the side-effect import chain that populated the `pluginHost`
 * singleton. Called ONCE at process start (startServer / CLI binaries) on a
 * fresh PluginRegistry; the registry is immutable afterwards.
 *
 * Registers the FOUR types still built in DIRECTLY (tier (a)).
 *
 * `endpoint` and `dto` left in 0.2.2: they ship together in the builtin envelope
 * `plugins/c4s-plugin-api-contracts/`, registered through the M33 loader like any
 * other package — the third registration tier, and the pilot for migrating the
 * remaining four. `database-table` left earlier, as the preinstalled external
 * plugin `c4s-plugin-simple-database-tables`. Both load right after this call.
 */
export function registerAllPlugins(registry: PluginRegistry): void {
  registerUiView(registry);
  registerAc(registry);
  registerDesignSystem(registry);
  registerDiagram(registry);
}

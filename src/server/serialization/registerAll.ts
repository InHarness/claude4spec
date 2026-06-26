import type { PluginRegistry } from '../core/plugin-host/types.js';
import { onRegister as registerEndpoint } from '../entities/endpoint/plugin.js';
import { onRegister as registerDto } from '../entities/dto/plugin.js';
import { onRegister as registerUiView } from '../entities/ui-view/plugin.js';
import { onRegister as registerAc } from '../entities/ac/plugin.js';
import { onRegister as registerDesignSystem } from '../entities/design-system/plugin.js';
import { onRegister as registerDiagram } from '../entities/diagram/plugin.js';

/**
 * M31: replaces the side-effect import chain that populated the `pluginHost`
 * singleton. Called ONCE at process start (startServer / CLI binaries) on a
 * fresh PluginRegistry; the registry is immutable afterwards.
 *
 * Registers the SIX core entity types. `database-table` is no longer here — it
 * ships as the preinstalled `c4s-plugin-simple-database-tables` plugin, loaded
 * through the M33 loader (`PREDEFINED_PLUGINS`) right after this call.
 */
export function registerAllPlugins(registry: PluginRegistry): void {
  registerEndpoint(registry);
  registerDto(registry);
  registerUiView(registry);
  registerAc(registry);
  registerDesignSystem(registry);
  registerDiagram(registry);
}

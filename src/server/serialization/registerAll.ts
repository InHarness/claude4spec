import type { PluginRegistry } from '../core/plugin-host/types.js';
import { onRegister as registerEndpoint } from '../entities/endpoint/plugin.js';
import { onRegister as registerDto } from '../entities/dto/plugin.js';
import { onRegister as registerDatabaseTable } from '../entities/database-table/plugin.js';
import { onRegister as registerUiView } from '../entities/ui-view/plugin.js';
import { onRegister as registerAc } from '../entities/ac/plugin.js';

/**
 * M31: replaces the side-effect import chain that populated the `pluginHost`
 * singleton. Called ONCE at process start (startServer / CLI binaries) on a
 * fresh PluginRegistry; the registry is immutable afterwards.
 */
export function registerAllPlugins(registry: PluginRegistry): void {
  registerEndpoint(registry);
  registerDto(registry);
  registerDatabaseTable(registry);
  registerUiView(registry);
  registerAc(registry);
}

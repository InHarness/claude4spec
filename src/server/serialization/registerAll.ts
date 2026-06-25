import type { PluginRegistry } from '../core/plugin-host/types.js';
import { onRegister as registerEndpoint } from '../entities/endpoint/plugin.js';
import { onRegister as registerDto } from '../entities/dto/plugin.js';
// DISABLED: the external c4s-plugin-simple-database-tables plugin now owns the
// `database-table` backend under the same slug, so the in-host built-in must not
// register and shadow it. Full removal of the in-host module (entity, MCP server,
// serializer, spec pages) is the separate database-table migration (brief
// 0-1-82-to-0-1-83); this only stops the registration.
// import { onRegister as registerDatabaseTable } from '../entities/database-table/plugin.js';
import { onRegister as registerUiView } from '../entities/ui-view/plugin.js';
import { onRegister as registerAc } from '../entities/ac/plugin.js';
import { onRegister as registerDesignSystem } from '../entities/design-system/plugin.js';
import { onRegister as registerDiagram } from '../entities/diagram/plugin.js';

/**
 * M31: replaces the side-effect import chain that populated the `pluginHost`
 * singleton. Called ONCE at process start (startServer / CLI binaries) on a
 * fresh PluginRegistry; the registry is immutable afterwards.
 */
export function registerAllPlugins(registry: PluginRegistry): void {
  registerEndpoint(registry);
  registerDto(registry);
  // DISABLED: owned by the external c4s-plugin-simple-database-tables plugin (see above).
  // registerDatabaseTable(registry);
  registerUiView(registry);
  registerAc(registry);
  registerDesignSystem(registry);
  registerDiagram(registry);
}

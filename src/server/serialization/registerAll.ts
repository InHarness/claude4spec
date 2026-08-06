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
 * remaining four. `spreadsheet` and `database-table` followed, in
 * `plugins/c4s-plugin-spreadsheets/` and `plugins/c4s-plugin-database-tables/`.
 * All of them load right after this call.
 *
 * `database-table` used to be described here as a "preinstalled external
 * plugin". That stopped being true at 2.0.0 and the description outlived it by
 * two releases: the packages it named declare `hostApiVersion: '^1.0.0'`, so the
 * loader's gate dropped them and the type was not preinstalled — it was absent.
 */
export function registerAllPlugins(registry: PluginRegistry): void {
  registerUiView(registry);
  registerAc(registry);
  registerDesignSystem(registry);
  registerDiagram(registry);
}

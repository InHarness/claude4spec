import type { PluginRegistry } from '../core/plugin-host/types.js';
import { onRegister as registerAc } from '../entities/ac/plugin.js';
import { onRegister as registerDiagram } from '../entities/diagram/plugin.js';

/**
 * M31: replaces the side-effect import chain that populated the `pluginHost`
 * singleton. Called ONCE at process start (startServer / CLI binaries) on a
 * fresh PluginRegistry; the registry is immutable afterwards.
 *
 * Registers the TWO types still built in DIRECTLY (tier (a)).
 *
 * `endpoint` and `dto` left in 0.2.2: they ship together in the builtin envelope
 * `plugins/c4s-plugin-api-contracts/`, registered through the M33 loader like any
 * other package — the second registration tier, and the pilot for the migration
 * this function is the remainder of. `spreadsheet` and `database-table`
 * followed, in `plugins/c4s-plugin-spreadsheets/` and
 * `plugins/c4s-plugin-database-tables/`; `ui-view` and `design-system` completed
 * it in 0.2.18, travelling together in `plugins/c4s-plugin-frontend-mockups/`
 * because `ui-view.designSystemSlug` declares `ref: 'design-system'` and a fixed
 * single-target ref needs its target from the first registration. The canonical
 * list of built-in envelopes lives in M13, not here. All of them load right
 * after this call.
 *
 * `database-table` used to be described here as a "preinstalled external
 * plugin". That stopped being true at 2.0.0 and the description outlived it by
 * two releases: the packages it named declare `hostApiVersion: '^1.0.0'`, so the
 * loader's gate dropped them and the type was not preinstalled — it was absent.
 */
export function registerAllPlugins(registry: PluginRegistry): void {
  registerAc(registry);
  registerDiagram(registry);
}

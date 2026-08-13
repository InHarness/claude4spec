import type { PluginManifest } from '@c4s/plugin-runtime';
import { spreadsheetEntity } from './entity/spreadsheet/index.js';
import { spreadsheetCommands } from './capabilities/commands.js';

/**
 * The envelope's manifest.
 *
 * `hostApiVersion: '^3.0.0'` is the whole reason this package exists as a port
 * rather than a copy. The published plugin `c4s-plugin-spreadsheets 0.0.6`
 * declared `^1.0.0`, and the loader's version gate `continue`s BEFORE
 * `registerPlugin` — so under 2.0.0 it did not fail loudly, it simply was not
 * there: no `spreadsheet` type, no tools, no embed, and a
 * `PLUGIN_HOST_API_MISMATCH` line in the log as the only evidence.
 *
 * `onUnregister` is a deliberate no-op. Dropping the projection tables on
 * unregister would destroy the derived index of a type the user may re-enable
 * five seconds later; the entity FILES are the source of truth and the index is
 * rebuilt from them, so there is nothing here worth being clever about.
 */
export const manifest: PluginManifest = {
  name: 'c4s-plugin-spreadsheets',
  version: '0.2.12',
  hostApiVersion: '^3.0.0',
  engines: { node: '>=20' },
  contributes: {
    entities: [spreadsheetEntity],
    commands: spreadsheetCommands,
  },
  onUnregister: () => {},
};

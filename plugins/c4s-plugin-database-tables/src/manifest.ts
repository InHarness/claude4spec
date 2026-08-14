import type { PluginManifest } from '@c4s/plugin-runtime';
import { databaseTableEntity } from './entity/database-table/index.js';
import { databaseTableCommands } from './capabilities/commands.js';

/**
 * The envelope's manifest.
 *
 * `hostApiVersion: '^2.0.0'` is the entire reason this package exists. BOTH
 * packages that used to contribute `database-table` declare `^1.0.0`, and the
 * loader's version gate `continue`s BEFORE `registerPlugin` — so under 2.0.0
 * the type did not fail loudly, it simply was not there. No sidebar tab, no
 * routes, no tools, and a `PLUGIN_HOST_API_MISMATCH` line in the log as the
 * only evidence, while 71 entity files sat on disk across six projects that
 * nothing could read.
 *
 * NO `settings`, NO `writingStyles`. The retired plugin shipped three
 * `src/capabilities/` stubs untouched from the scaffold — a Polish writing-style
 * document about how to write plugin specs, and a settings module that wrote
 * under the key `c4s-plugin-scaffold`. They were registered unconditionally
 * (`config.entities` filters entity types only), so they were live. They carry
 * no domain value and are not ported.
 *
 * `onUnregister` is a deliberate no-op. Dropping the projection on unregister
 * would destroy the derived index of a type the user may re-enable five seconds
 * later; the entity FILES are the source of truth and the index rebuilds from
 * them.
 */
export const manifest: PluginManifest = {
  name: 'c4s-plugin-database-tables',
  version: '0.2.12',
  hostApiVersion: '^2.0.0',
  engines: { node: '>=20' },
  contributes: {
    entities: [databaseTableEntity],
    commands: databaseTableCommands,
  },
  onUnregister: () => {},
};

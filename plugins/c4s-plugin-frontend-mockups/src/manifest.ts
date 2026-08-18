import type { PluginManifest } from '@c4s/plugin-runtime';
import { designSystemEntity } from './entity/design-system/index.js';
import { uiViewEntity } from './entity/ui-view/index.js';
import { frontendMockupCommands } from './capabilities/commands.js';

/**
 * The built-in envelope contributing `ui-view` and `design-system`.
 *
 * The two travel TOGETHER, and that is a rule rather than a convenience:
 * `ui-view.designSystemSlug` declares `ref: 'design-system'` — a fixed,
 * single-target ref — so its target must exist from the first registration.
 * Splitting the pair across two envelopes would cut the declaration. (The rule
 * does NOT extend to a polymorphic ref: `ac.verifies[]` targets any active type,
 * and applying it there would force one envelope for everything.)
 *
 * `hostApiVersion: '^2.0.0'` matters more than it looks. The loader's version
 * gate `continue`s BEFORE `registerPlugin`, so a stale range does not fail
 * loudly — both types are simply NOT THERE: no sidebar tab, no routes, no
 * serializer, and a `PLUGIN_HOST_API_MISMATCH` line in the log as the only
 * evidence, while the entity files sit on disk with nothing able to read them.
 *
 * Unregistration is the HOST's: `registry.unregisterPlugin(name)` fans out over
 * this envelope's `contributedTypes[]`, so BOTH types come off the registry at
 * once, and with them — because every one of those consumers reads by PULL — the
 * ELEMENTS sidebar entries, the slash commands and the system-prompt
 * contribution (`roleNoun` / `narrativeBlock`). The routes and MCP server
 * factories come down separately, on the `ProjectContext` rebuild.
 *
 * This envelope therefore declares NO `onUnregister`. Since 0.2.29 the slot is
 * optional and exists only for a plugin's OWN resources — a timer, a watcher, an
 * open connection, allocatable solely in the imperative `backend.mount` — and
 * this package is purely declarative, so it holds none. Unwiring its own types
 * or commands here would be a bug: it would duplicate the host's work.
 *
 * That teardown is per-ENVELOPE and takes both types down at once — which is the
 * registration axis. It is not the activation axis: `config.entities` still
 * whitelists a single type, so deactivating `ui-view` leaves `design-system`
 * active and vice versa, despite the shared envelope.
 */
export const manifest: PluginManifest = {
  name: 'c4s-plugin-frontend-mockups',
  version: '0.2.18',
  hostApiVersion: '^2.0.0',
  engines: { node: '>=20' },
  contributes: {
    // `design-system` FIRST — see `entity/ui-view/index.ts` on `dependsOn`.
    entities: [designSystemEntity, uiViewEntity],
    commands: frontendMockupCommands,
  },
};

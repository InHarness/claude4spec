import type { PluginManifest } from '@c4s/plugin-runtime';
import { acEntity } from './entity/ac/index.js';
import { acAuditSubagent } from './subagents/ac-audit.js';
import { acCommands } from './capabilities/commands.js';

/**
 * The built-in envelope contributing `ac` and the `ac-audit` subagent.
 *
 * The two travel TOGETHER, and that is a rule rather than a convenience — but
 * NOT the rule that pairs `ui-view` with `design-system`. That one is about a
 * `ref` with a fixed single target, which must exist from the first
 * registration; `ac.verifies[]` is polymorphic (`{type, slug}[]` aimed at any
 * active type), and applying the ref rule there would force one envelope for
 * everything. What binds these two is the other rule: the unit of distribution
 * is the envelope's WHOLE contribution. `ac-audit` reads acceptance criteria and
 * nothing else, so in a project with no active `ac` type it has no subject
 * matter — a subagent offered in every turn with nothing to work on.
 *
 * `hostApiVersion: '^2.0.0'` matters more than it looks, and this envelope
 * carried `'^1.0.0'` right up to the move. The loader's version gate `continue`s
 * BEFORE `registerPlugin`, so a stale range does not fail loudly — the type is
 * simply NOT THERE: no sidebar tab, no `/acs` routes, no serializer, no
 * `ac-tools` MCP server, no `ac-audit`, and a `PLUGIN_HOST_API_MISMATCH` line in
 * the log as the only evidence, while the entity files sit on disk with nothing
 * able to read them. `registerAll.ts` records this happening once already, to
 * `database-table`, and it went unnoticed for two releases.
 *
 * ## What `hostApiVersion` covers here
 *
 * 1. the shapes of the slots this envelope occupies: `contributes.entities` and
 *    `contributes.subagents`;
 * 2. the declarative half of the data contract — the `verifies[]` value
 *    collection with its `ref` / `onMissing` / `onDelete` flags — and the L9
 *    serialization contract derived from it;
 * 3. the renderer and detail-panel slot signatures;
 * 4. the `backend.mcpServer` slot, the `McpServerFactory` facade type, and the
 *    `createMcpServer` / `mcpTool` builder signatures;
 * 5. the read-core operations bound through `MountContext` — this envelope reads
 *    the entities `verifies[]` aims at with them, and gets back a SERIALIZED
 *    RECORD, never a raw projection row.
 *
 * NOT covered, and changeable without a bump: `AcAnalysisService` and the shape
 * of its verdict, the scope of `ac-audit`'s work, the text of the system-prompt
 * block, and the layout of the list screen and detail panel.
 *
 * Unregistration is the HOST's: `registry.unregisterPlugin(name)` fans out over
 * `contributedTypes[]`, and because every consumer reads by PULL, the ELEMENTS
 * sidebar entry, the slash command, the system-prompt contribution (`roleNoun` /
 * `narrativeBlock`) and `subagentsFor()`'s view of `ac-audit` all go with it. The
 * routes and the MCP server factory come down separately, on the
 * `ProjectContext` rebuild.
 *
 * So this envelope declares NO `onUnregister`, matching the other five. The slot
 * exists for a plugin's OWN resources — a timer, a watcher, an open connection,
 * allocatable only in an imperative `backend.mount` — and this package holds
 * none: its one imperative act is constructing an MCP server the rebuild owns.
 * Unwiring the type here would duplicate the host's work.
 *
 * That teardown is per-ENVELOPE, which is the registration axis. It is not the
 * activation axis: `config.entities` still whitelists the type by name, so
 * deactivating `ac` is a separate question from unregistering this package.
 */
export const manifest: PluginManifest = {
  name: 'c4s-plugin-ac',
  version: '0.2.80',
  hostApiVersion: '^2.0.0',
  engines: { node: '>=20' },
  contributes: {
    entities: [acEntity],
    subagents: [acAuditSubagent],
    commands: acCommands,
  },
};

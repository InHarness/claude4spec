/**
 * M44 `317cwhlj` / `3f5ej79s` — the turn argument contract: the whole `mcpServers`
 * argument `adapter.execute(...)` receives, assembled by the context-type
 * registry's turn handler in three steps.
 *
 * 1. **The host pool.** `ProjectPluginHost.buildMcpServers()` hands over every
 *    server registered in the plugin host — generic `entity-tools`, the custom
 *    servers of active types and plugins, and the host's own `reference-tools`
 *    and `release-tools`, which the host registers in that same pool like a
 *    plugin's server (M13 `mbladez6`, 3b). The pool does not know the context
 *    type, so the caller narrows it by its registry row's `mcp.pluginServers`:
 *    `'release-only'` (`brief`) takes only `release-tools`, `'all'` the whole
 *    pool. The narrowing is a NAME predicate handed to the host, so a factory
 *    the turn does not take is never invoked — each one builds a whole server,
 *    several times per turn.
 * 2. **The handler's servers.** The turn handler appends its own servers, each
 *    behind its registry gate (built by the caller, which holds the thread's
 *    services). On a server-name collision the handler's entry wins over the
 *    pool's — the pool factory under that name is not built at all, never
 *    mounted next to it.
 * 3. **The profile gate.** `gateServers` filters the tools by the profile's
 *    operation classes and drops a server left with no tools, which is what
 *    makes `ask` read-only by enforcement rather than by prompt.
 *
 * Pure: one function, one result, shared by the `<tooling>` inventory and by
 * every `adapter.execute`, so the set the model is told about and the set it is
 * given cannot differ.
 */

import type { ChatContextType } from '../../shared/entities.js';
import type { McpServerFactory } from '../../shared/plugin-host/mcp.js';
import { gateServers } from '../operations/profile-gate.js';
import { BRIEF_ALLOWED_PLUGIN_MCP, type McpServerSet } from '../operations/profiles.js';

export interface TurnServerEntry {
  name: string;
  server: McpServerFactory;
}

/** Selects pool factories by server name, before any of them is invoked. */
export type PoolSelector = (name: string) => boolean;

/**
 * Step 1: which pool servers a context type takes, as a predicate over the
 * factory NAME. `pluginServers` is the caller's registry value (`ctx.mcp` /
 * the external surface's server set) — the one rule both channels select by.
 * `shadowed` are names a handler entry owns; their pool factory is skipped.
 */
export function poolSelector(
  pluginServers: McpServerSet['pluginServers'],
  shadowed: ReadonlySet<string> = new Set(),
): PoolSelector {
  return pluginServers === 'release-only'
    ? (name) => BRIEF_ALLOWED_PLUGIN_MCP.has(name) && !shadowed.has(name)
    : (name) => !shadowed.has(name);
}

/**
 * The three steps, in order. `buildPool` builds the host pool restricted to the
 * selector (`ProjectPluginHost.buildMcpServers({ include })`); `handlerEntries`
 * are the handler's own servers, already selected by their registry gates;
 * `pluginServerNames` are the `${type}-tools` servers whose tools a plugin, not
 * this repo, decided (the gate fails them closed for read-only profiles).
 */
export function assembleTurnMcpServers(args: {
  contextType: ChatContextType;
  pluginServers: McpServerSet['pluginServers'];
  buildPool: (include: PoolSelector) => readonly TurnServerEntry[];
  handlerEntries: readonly TurnServerEntry[];
  pluginServerNames?: ReadonlySet<string>;
}): TurnServerEntry[] {
  const handlerNames = new Set(args.handlerEntries.map(({ name }) => name));
  const merged = [
    ...args.buildPool(poolSelector(args.pluginServers, handlerNames)),
    ...args.handlerEntries,
  ];
  return gateServers(args.contextType, merged, args.pluginServerNames);
}

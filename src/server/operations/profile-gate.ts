/**
 * The profile gate — where "an operation outside the profile is not callable"
 * stops being a sentence and becomes a filter.
 *
 * The gate has to act while the TOOL LIST is being built. Checking the profile
 * inside a handler would be too late in the way that matters: the operation would
 * still appear in `tools/list`, so the model would still see it, plan around it,
 * call it, and get a refusal it has to recover from. Removing it from the list
 * means the model never knew it existed — which is the actual contract ("the
 * caller gets: unknown tool").
 *
 * ## What is gated, and what is deliberately not
 *
 * A tool is admitted iff the profile admits its operation class. Where that
 * class comes from depends on whose server the tool is on, and the split is the
 * whole design:
 *
 * - **Host-owned servers** (`entity-tools`, `reference-tools`, `page-tools`,
 *   `release-tools`, `plan-tools`, `brief-tools`, `c4s-tools`,
 *   `workspace-tools`, `transagent-tools`) — the class is the host catalog's
 *   row. An undeclared tool passes through, governed by the coarse per-server
 *   dimensions (`McpServerSet`) exactly as before. Their surface ships in this
 *   repo and is reviewed with it, so "undeclared" means "nobody has written the
 *   catalog row yet", not "unknown". Withholding those would turn every future
 *   catalog entry into a regression in an unrelated profile: declaring an
 *   operation must be what NARROWS access, never what accidentally grants it.
 *
 * - **Plugin servers** (`${type}-tools`, and any server a plugin registered
 *   while mounting) — the class is the PLUGIN'S OWN DECLARATION, never the host
 *   catalog (2.1.78, M44 / M13 `sxzegart`): the `operationClass` the tool was
 *   registered with through `mcpTool()`'s sixth argument, honoured only when the
 *   server comes from a BASE-layer envelope (workspace, npm/preinstalled,
 *   built-in `plugins/<pkg>/src/` in both variants, prebuilt). A tool with no
 *   declaration is `write`; a tool of a project-local OVERLAY envelope is
 *   `write` whatever it declares. `annotations.readOnlyHint` is never an input:
 *   it is a hint published to foreign clients, which the host does not vouch
 *   for. The profile picks by class alone and does not know where a tool came
 *   from; the origin only decides whether the declaration is trusted — so the
 *   catalog still "does not know profiles", and a plugin declares a class, not
 *   membership in a profile.
 *
 * The trust model: the gate guards against a MISCLASSIFICATION, not against a
 * malicious plugin — plugin code runs in the host process anyway. So the trust
 * boundary sits where the operator picks packages (the base), not where a
 * project repository brings code in (the overlay).
 *
 * The asymmetry is the point. On the surface this repo controls, an omission is a
 * gap someone can see and fix; on the surface it does not, an omission is a hole.
 *
 * ## Rebuilding rather than mutating
 *
 * A server whose tools all survive is returned untouched — no rebuild, no new
 * SDK server. A server that loses some is rebuilt from the surviving
 * declarations, and one that loses all of them is dropped entirely rather than
 * mounted empty. Rebuilding is cheap and safe here because these handles are
 * already built fresh per turn.
 */

import type { ChatContextType } from '../../shared/entities.js';
import type { McpServerFactory, McpToolDeclaration, McpToolOperationClass } from '../../shared/plugin-host/mcp.js';
import { createMcpServer } from '../plugin-runtime/create-mcp-server.js';
import type { McpToolDefinition } from '@inharness-ai/agent-adapters';
import { CATALOG } from './catalog.js';
import { registerCoreOperations } from './core-operations.js';
import { PROFILES, profileAdmits } from './profiles.js';

/**
 * The single seeding point of the process-wide catalog.
 *
 * Done here, at module init, because this is the module whose answers are WRONG
 * rather than merely absent on an unseeded catalog: `toolAdmittedByProfile`
 * treats "no declaration" on a host server as "not gated", so an unseeded catalog
 * would silently pass every host write tool through to every profile — a
 * security-shaped failure that no test of the gate's own logic would catch.
 * `registerCoreOperations` is idempotent, so importing this from several places
 * is safe.
 */
registerCoreOperations();

/** Where a plugin server's code came from — decides whether its declarations are trusted. */
export type PluginServerLayer = 'base' | 'overlay';

/**
 * 2.1.78 (M44) — the EFFECTIVE class of a plugin server's tool: the declared
 * `operationClass` for a base-layer envelope, `write` when it declared none,
 * and `write` for a project-local overlay regardless of the declaration.
 */
export function pluginToolClass(
  tool: Pick<McpToolDeclaration, 'operationClass'>,
  opts: { overlay?: boolean } = {},
): McpToolOperationClass {
  if (opts.overlay) return 'write';
  return tool.operationClass === 'read' ? 'read' : 'write';
}

/**
 * Does this profile admit the tool?
 *
 * `plugin` says the tool came off a plugin's own server, whose class comes from
 * the plugin's declaration rather than from the host catalog. `overlay` says that
 * server came from a project-local envelope, whose declaration is not trusted. A
 * bare tool NAME carries no declaration, so on a plugin server it is `write`.
 */
export function toolAdmittedByProfile(
  profile: ChatContextType,
  tool: string | Pick<McpToolDeclaration, 'name' | 'operationClass'>,
  opts: { plugin?: boolean; overlay?: boolean } = {},
): boolean {
  const decl = typeof tool === 'string' ? { name: tool } : tool;
  if (opts.plugin || opts.overlay) {
    /**
     * A plugin's tool: the class it declared (base only), else `write`.
     *
     * The host catalog is deliberately not consulted. A row for a HOST
     * operation says nothing about a plugin's tool that happens to share its
     * name — the gate matches by name, so a plugin shipping `update_plan` would
     * otherwise be classified `plan` and admitted to `ask`. And an undeclared
     * plugin tool is treated as the write it may well be, so `spreadsheet-tools`'
     * mutating operations stay out of `ask` and `brief`, whose only other
     * restraint (forced plan mode) does not apply to MCP at all.
     */
    return PROFILES[profile].operationClasses.has(pluginToolClass(decl, { overlay: opts.overlay }));
  }
  const op = CATALOG.get(decl.name);
  // A row kept for a plugin-rendered operation (`link_dto` / `unlink_dto`, which
  // carry a spec-operation record) speaks for the plugin's server, never for a
  // host tool sharing its name.
  if (op && op.contributedBy !== 'plugin') return profileAdmits(profile, op);
  // Undeclared on a host-owned server: pass-through (see the module comment).
  return true;
}

/**
 * Filter one server's tools down to what the profile admits.
 * Returns `null` when nothing survives — the caller should not mount it at all.
 *
 * `pluginServerNames` carries the plugin servers (see {@link pluginServerNamesFor}),
 * i.e. the ones whose contents the host did not write; `overlayServerNames` the
 * subset of them that came from a project-local overlay. Omitting them keeps the
 * host-server rule for every server, which is only correct when the caller knows
 * none of them are plugin-contributed.
 */
export function gateServer(
  profile: ChatContextType,
  name: string,
  server: McpServerFactory,
  pluginServerNames?: ReadonlySet<string>,
  overlayServerNames?: ReadonlySet<string>,
): McpServerFactory | null {
  const declared = server.tools;
  // No captured declarations (a hand-rolled or pre-0.2.13 handle) — nothing to
  // enumerate, so nothing to filter. Passed through, as the coarse gate always did.
  if (!declared || declared.length === 0) return server;

  const overlay = overlayServerNames?.has(name) === true;
  const plugin = overlay || pluginServerNames?.has(name) === true;
  const kept = declared.filter((t) => toolAdmittedByProfile(profile, t, { plugin, overlay }));
  if (kept.length === declared.length) return server;
  if (kept.length === 0) return null;

  return createMcpServer({
    name,
    // `McpToolDeclaration` is the host-owned structural view of exactly the
    // objects `mcpTool()` produced; handing them back to the builder rebuilds the
    // same tools minus the withheld ones (their declared class included).
    tools: kept as unknown as McpToolDefinition[],
  });
}

/** Apply the gate across a whole server map. */
export function gateServers(
  profile: ChatContextType,
  servers: Array<{ name: string; server: McpServerFactory }>,
  pluginServerNames?: ReadonlySet<string>,
  overlayServerNames?: ReadonlySet<string>,
): Array<{ name: string; server: McpServerFactory }> {
  const out: Array<{ name: string; server: McpServerFactory }> = [];
  for (const { name, server } of servers) {
    const gated = gateServer(profile, name, server, pluginServerNames, overlayServerNames);
    if (gated) out.push({ name, server: gated });
  }
  return out;
}

/**
 * The plugin servers of a project — the servers whose tools a plugin, not this
 * repo, decided: the `${type}-tools` server of each active entity type, plus
 * every server a plugin registered while mounting (`layers`, recorded by the
 * project host at `mountBackend`).
 *
 * The `${type}-tools` names come from the same convention `manifest-adapter`
 * uses when it lowers the declarative `backend.mcpServer` slot, so the set
 * cannot drift from what is actually mounted.
 */
export function pluginServerNamesFor(
  types: readonly string[],
  layers?: ReadonlyMap<string, PluginServerLayer>,
): ReadonlySet<string> {
  const out = new Set(types.map((t) => `${t}-tools`));
  for (const name of layers?.keys() ?? []) out.add(name);
  return out;
}

/** The plugin servers that came from a project-local overlay envelope (their declarations are ignored). */
export function overlayServerNamesFor(layers?: ReadonlyMap<string, PluginServerLayer>): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [name, layer] of layers ?? []) if (layer === 'overlay') out.add(name);
  return out;
}

/** Exported for the gating test: the tool names a profile withholds from a server. */
export function withheldTools(
  profile: ChatContextType,
  declared: readonly McpToolDeclaration[],
  opts: { plugin?: boolean; overlay?: boolean } = {},
): string[] {
  return declared.filter((t) => !toolAdmittedByProfile(profile, t, opts)).map((t) => t.name);
}

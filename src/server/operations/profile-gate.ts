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
import type { OperationClass } from './catalog.js';
import { registerCoreOperations } from './core-operations.js';
import { resolveHostToolRecord, type HostToolChannel } from './host-tool-record.js';
import { PROFILES } from './profiles.js';

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
 * 2.1.79 (M44) — the EFFECTIVE class of one mounted tool: the single classifier
 * shared by the profile gate and by the prompt composition (the plan-mode "Do
 * not call" list, M48). A second classification would let the prompt and the
 * gate drift apart.
 *
 * The SERVER that exposes the tool decides the source of the class — never the
 * existence of an operation record:
 * - (a) a plugin server (any server registered while an envelope mounted, under
 *   any name): the `operationClass` it declared in `mcpTool`, honoured only for
 *   a base-layer envelope — `write` for a project-local overlay;
 * - (b) no declaration on a plugin server: `write` — even when the operation
 *   has a `spec-operation` record (`link_dto`, `unlink_dto`): the record stays
 *   in the catalog for channels and renderings, it is not an input here;
 * - (c) a host server: the class of the tool's host record — 2.1.83, found by
 *   {@link resolveHostToolRecord}, the one definition the plan-mode list uses
 *   too: the row named after the tool, else the row whose declared renderings
 *   name `<server>.<tool>` in its channel (`runTransagent` → `spawn_child_turn`,
 *   `turn`; `entity-tools.describe_entity_type` → `describe_types`, `read`).
 *   The rendering step needs `opts.server`; without it only the name applies.
 *
 * `undefined` means a host tool with no record (neither by name nor by a
 * declared rendering) — the gate passes it through, never as `write`, and the
 * plan-mode list does not name it (see the module comment).
 * `annotations.readOnlyHint` is never an input.
 */
export function effectiveToolClass(
  tool: string | Pick<McpToolDeclaration, 'name' | 'operationClass'>,
  opts: { plugin?: boolean; overlay?: boolean; server?: string; channel?: HostToolChannel } = {},
): OperationClass | undefined {
  const decl = typeof tool === 'string' ? { name: tool } : tool;
  /**
   * A plugin's tool: the class it declared (base only), else `write`. The host
   * catalog is deliberately not consulted: a row for a HOST operation says
   * nothing about a plugin's tool that happens to share its name (a plugin
   * shipping `update_plan` would otherwise be classified `plan` and admitted to
   * `ask`), and an undeclared plugin tool is treated as the write it may well
   * be — `ask`'s only other restraint, forced plan mode, does not apply to MCP.
   */
  if (opts.plugin || opts.overlay) return pluginToolClass(decl, { overlay: opts.overlay });
  // A row kept for a plugin-rendered operation (`link_dto` / `unlink_dto`) speaks
  // for the plugin's server, never for a host tool — the resolver skips it.
  return resolveHostToolRecord(decl, { server: opts.server, channel: opts.channel })?.opClass;
}

/**
 * Does this profile admit the tool? The profile picks by the tool's effective
 * class alone ({@link effectiveToolClass}); an undeclared host tool passes
 * through.
 */
export function toolAdmittedByProfile(
  profile: GateProfile,
  tool: string | Pick<McpToolDeclaration, 'name' | 'operationClass'>,
  opts: { plugin?: boolean; overlay?: boolean; server?: string; channel?: HostToolChannel } = {},
): boolean {
  const cls = effectiveToolClass(tool, opts);
  // Undeclared on a host-owned server: pass-through (see the module comment).
  if (cls === undefined) return true;
  return profileClasses(profile).has(cls);
}

/**
 * 2.1.88 (M43 `l3route0`, M44 `3f5ej79s`) — what the gate filters by: a profile
 * name of the `mcp` channel's table ({@link PROFILES}), or the admitted classes
 * themselves — the turn passes its row's `Klasy operacji` column, since profile
 * membership is a column of the context-type registry.
 */
export type GateProfile = ChatContextType | ReadonlySet<OperationClass>;

function profileClasses(profile: GateProfile): ReadonlySet<OperationClass> {
  return typeof profile === 'string' ? PROFILES[profile].operationClasses : profile;
}

/**
 * Filter one server's tools down to what the profile admits.
 * Returns `null` when nothing survives — the caller should not mount it at all.
 *
 * `pluginServerNames` carries the plugin servers (see {@link pluginServerNamesFor}),
 * i.e. the ones whose contents the host did not write; `overlayServerNames` the
 * subset of them that came from a project-local overlay. Omitting them keeps the
 * host-server rule for every server, which is only correct when the caller knows
 * none of them are plugin-contributed. `channel` is where the server is mounted
 * — `internal` for a turn, `mcp` for the external surface — and picks which
 * declared renderings resolve a host tool's record.
 */
export function gateServer(
  profile: GateProfile,
  name: string,
  server: McpServerFactory,
  pluginServerNames?: ReadonlySet<string>,
  overlayServerNames?: ReadonlySet<string>,
  channel: HostToolChannel = 'internal',
): McpServerFactory | null {
  const declared = server.tools;
  // No captured declarations (a hand-rolled or pre-0.2.13 handle) — nothing to
  // enumerate, so nothing to filter. Passed through, as the coarse gate always did.
  if (!declared || declared.length === 0) return server;

  const overlay = overlayServerNames?.has(name) === true;
  const plugin = overlay || pluginServerNames?.has(name) === true;
  const kept = declared.filter((t) => toolAdmittedByProfile(profile, t, { plugin, overlay, server: name, channel }));
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
  profile: GateProfile,
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
  opts: { plugin?: boolean; overlay?: boolean; server?: string; channel?: HostToolChannel } = {},
): string[] {
  return declared.filter((t) => !toolAdmittedByProfile(profile, t, opts)).map((t) => t.name);
}

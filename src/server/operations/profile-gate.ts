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
 * A declared tool is admitted iff the profile admits its operation class. What
 * happens to an UNDECLARED tool depends on whose server it is on, and the split
 * is the whole design:
 *
 * - **Host-owned servers** (`entity-tools`, `reference-tools`, `page-tools`,
 *   `release-tools`, `plan-tools`, `brief-tools`, `c4s-tools`,
 *   `workspace-tools`, `transagent-tools`) — pass through, governed by the coarse per-server
 *   dimensions (`McpServerSet`) exactly as before. Their surface ships in this
 *   repo and is reviewed with it, so "undeclared" means "nobody has written the
 *   catalog row yet", not "unknown". Withholding those would turn every future
 *   catalog entry into a regression in an unrelated profile: declaring an
 *   operation must be what NARROWS access, never what accidentally grants it.
 *
 * - **Plugin servers** (`${type}-tools`) — FAIL CLOSED for a profile that admits
 *   no writes. Here "undeclared" really does mean unknown: an entity plugin
 *   contributes arbitrary tools the host has never seen, and guessing "probably
 *   a read" is how `spreadsheet-tools`' six mutating operations stayed reachable
 *   from `ask`, whose only other restraint is a forced plan mode that does not
 *   apply to MCP at all. A plugin operation reaches a read-only profile only if
 *   the catalog says it is a read.
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
import type { McpServerFactory, McpToolDeclaration } from '../../shared/plugin-host/mcp.js';
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
 * treats "no declaration" as "not gated", so an unseeded catalog would silently
 * pass every write tool through to every profile — a security-shaped failure
 * that no test of the gate's own logic would catch. `registerCoreOperations` is
 * idempotent, so importing this from several places is safe.
 */
registerCoreOperations();

/**
 * Does this profile admit the tool?
 *
 * `plugin` says the tool came off a `${type}-tools` server — an entity plugin's
 * own surface — which changes what "undeclared" means. See {@link gateServer}.
 */
export function toolAdmittedByProfile(
  profile: ChatContextType,
  toolName: string,
  opts: { plugin?: boolean } = {},
): boolean {
  const op = CATALOG.get(toolName);
  /**
   * A declaration counts only if it describes the surface the tool came from.
   *
   * A catalog row for a HOST operation says nothing about a plugin's tool that
   * happens to share its name — and the gate matches by name alone. So a plugin
   * shipping `update_plan` would be classified `plan` and admitted to the
   * read-only `ask` profile, running its own mutating handler on a connection
   * built to be unable to mutate. Requiring `contributedBy: 'plugin'` here sends
   * that case to the fail-closed default below instead, which is the whole point
   * of treating a plugin's surface as unvouched-for.
   */
  const applies = op && (opts.plugin ? op.contributedBy === 'plugin' : op.contributedBy !== 'plugin');
  if (op && applies) return profileAdmits(profile, op);
  /**
   * Undeclared, on a plugin's own server, for a profile that admits no writes:
   * DENY.
   *
   * The general pass-through default below is right for host-owned servers,
   * whose surface ships in this repo and is reviewed with it. It is wrong here.
   * A plugin contributes arbitrary tools the host has never seen, and the
   * consequence of guessing "probably a read" is that a peer consulted through
   * `ask` — restrained by nothing else, since forced plan mode does not apply to
   * MCP — can call it. `spreadsheet-tools` alone ships six mutating operations,
   * and a plugin written tomorrow ships whatever it ships.
   *
   * So the plugin surface fails CLOSED for `ask` and `brief`: a plugin operation
   * is reachable from a read-only profile only if the catalog says it is a read.
   * The cost is that a new plugin's read tools are invisible to those profiles
   * until declared, which is a visible, fixable gap — unlike a write tool that
   * was silently reachable.
   */
  if (opts.plugin && !PROFILES[profile].operationClasses.has('write')) return false;
  return true;
}

/**
 * Filter one server's tools down to what the profile admits.
 * Returns `null` when nothing survives — the caller should not mount it at all.
 *
 * `pluginServerNames` carries the `${type}-tools` servers of the active entity
 * types, i.e. the ones whose contents the host did not write. Omitting it keeps
 * the permissive default for every server, which is only correct when the caller
 * knows none of them are plugin-contributed.
 */
export function gateServer(
  profile: ChatContextType,
  name: string,
  server: McpServerFactory,
  pluginServerNames?: ReadonlySet<string>,
): McpServerFactory | null {
  const declared = server.tools;
  // No captured declarations (a hand-rolled or pre-0.2.13 handle) — nothing to
  // enumerate, so nothing to filter. Passed through, as the coarse gate always did.
  if (!declared || declared.length === 0) return server;

  const plugin = pluginServerNames?.has(name) === true;
  const kept = declared.filter((t) => toolAdmittedByProfile(profile, t.name, { plugin }));
  if (kept.length === declared.length) return server;
  if (kept.length === 0) return null;

  return createMcpServer({
    name,
    // `McpToolDeclaration` is the host-owned structural view of exactly the
    // objects `mcpTool()` produced; handing them back to the builder rebuilds the
    // same tools minus the withheld ones.
    tools: kept as unknown as McpToolDefinition[],
  });
}

/** Apply the gate across a whole server map. */
export function gateServers(
  profile: ChatContextType,
  servers: Array<{ name: string; server: McpServerFactory }>,
  pluginServerNames?: ReadonlySet<string>,
): Array<{ name: string; server: McpServerFactory }> {
  const out: Array<{ name: string; server: McpServerFactory }> = [];
  for (const { name, server } of servers) {
    const gated = gateServer(profile, name, server, pluginServerNames);
    if (gated) out.push({ name, server: gated });
  }
  return out;
}

/**
 * The `${type}-tools` server name for each active entity type — the servers whose
 * tools a plugin, not this repo, decided.
 *
 * Derived from the same `${type}-tools` convention `manifest-adapter` uses when
 * it lowers the declarative `backend.mcpServer` slot, so the set cannot drift
 * from what is actually mounted.
 */
export function pluginServerNamesFor(types: readonly string[]): ReadonlySet<string> {
  return new Set(types.map((t) => `${t}-tools`));
}

/** Exported for the gating test: the tool names a profile withholds from a server. */
export function withheldTools(
  profile: ChatContextType,
  declared: readonly McpToolDeclaration[],
  opts: { plugin?: boolean } = {},
): string[] {
  return declared.filter((t) => !toolAdmittedByProfile(profile, t.name, opts)).map((t) => t.name);
}

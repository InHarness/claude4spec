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
 * A tool is filtered only when the catalog KNOWS its name. A tool the catalog has
 * no declaration for is passed through untouched and stays governed by the coarse
 * per-server dimensions (`McpServerSet`) exactly as before.
 *
 * That is a deliberate default, not an oversight. The catalog is seeded with the
 * operations this release renders; `release-*`, `runTransagent` and
 * `describe_entity_type` are not among them, and silently withholding a tool
 * because nobody has gotten round to declaring it yet would turn every future
 * catalog entry into a potential regression in an unrelated profile. Declaring an
 * operation must be what NARROWS access, never what accidentally grants it — so
 * the catalog can only ever take tools away here, and only from profiles that do
 * not admit their class.
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
import { profileAdmits } from './profiles.js';

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

/** Does this profile admit the tool? Unknown to the catalog ⇒ yes (see the module note). */
export function toolAdmittedByProfile(profile: ChatContextType, toolName: string): boolean {
  const op = CATALOG.get(toolName);
  if (!op) return true;
  return profileAdmits(profile, op);
}

/**
 * Filter one server's tools down to what the profile admits.
 * Returns `null` when nothing survives — the caller should not mount it at all.
 */
export function gateServer(
  profile: ChatContextType,
  name: string,
  server: McpServerFactory,
): McpServerFactory | null {
  const declared = server.tools;
  // No captured declarations (a hand-rolled or pre-0.2.13 handle) — nothing to
  // enumerate, so nothing to filter. Passed through, as the coarse gate always did.
  if (!declared || declared.length === 0) return server;

  const kept = declared.filter((t) => toolAdmittedByProfile(profile, t.name));
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
): Array<{ name: string; server: McpServerFactory }> {
  const out: Array<{ name: string; server: McpServerFactory }> = [];
  for (const { name, server } of servers) {
    const gated = gateServer(profile, name, server);
    if (gated) out.push({ name, server: gated });
  }
  return out;
}

/** Exported for the gating test: the tool names a profile withholds from a server. */
export function withheldTools(
  profile: ChatContextType,
  declared: readonly McpToolDeclaration[],
): string[] {
  return declared.filter((t) => !toolAdmittedByProfile(profile, t.name)).map((t) => t.name);
}

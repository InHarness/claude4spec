/**
 * 2.1.83 (M44 "Klasa narzędzia dla bramki profilu", L15) — the ONE definition of
 * a host-server tool's operation record, shared by both questions asked about
 * such a tool: the profile gate (is the tool in the turn — `effectiveToolClass`)
 * and the plan-mode "Do not call" list (would calling it change something —
 * M48 `<claude4spec_plan_mode>`). Before 2.1.83 the two looked the record up two
 * ways (the gate by name only, the list by name then by rendering), so
 * `runTransagent` had a record for the list and none for the gate.
 *
 * Resolution order:
 * 1. the catalog row NAMED after the tool (`decl.name`);
 * 2. failing that, the row whose declared renderings (`renderings`, each
 *    `'<server>.<tool>'`) name this tool in its channel — for a turn's tools the
 *    channel is `internal`. So `transagent-tools.runTransagent` resolves to
 *    `spawn_child_turn` (`turn`) and `entity-tools.describe_entity_type` to
 *    `describe_types` (`read`);
 * 3. neither: `undefined` — no effective class (the gate passes the tool
 *    through, it is never `write`: that rule is for plugin servers only), and
 *    the plan-mode list does not name it.
 *
 * A row a plugin contributed (`link_dto` / `unlink_dto`) never speaks for a
 * host tool, by name or by rendering. Only HOST-server tools are resolved here:
 * a plugin server's tool takes its class from its own `operationClass`
 * declaration, never from the host catalog.
 */

import { CATALOG, type OperationDeclaration } from './catalog.js';
import { registerCoreOperations } from './core-operations.js';

// Idempotent — an unseeded catalog would resolve every host tool to `undefined`.
registerCoreOperations();

/** The agentic channels a tool is rendered in (`renderings` keys). */
export type HostToolChannel = 'internal' | 'mcp';

export interface HostToolLocation {
  /**
   * The host server exposing the tool. Without it only step 1 (by name) can
   * apply: a rendering is `'<server>.<tool>'`, and guessing the server would let
   * one server's rendering speak for another's tool.
   */
  readonly server?: string;
  /** The channel the tool is mounted in; a turn's tools are `internal` (the default). */
  readonly channel?: HostToolChannel;
}

export function resolveHostToolRecord(
  tool: string | { readonly name: string },
  where: HostToolLocation = {},
): OperationDeclaration | undefined {
  const name = typeof tool === 'string' ? tool : tool.name;
  const byName = CATALOG.get(name);
  if (byName && byName.contributedBy !== 'plugin') return byName;
  if (where.server === undefined) return undefined;
  const rendered = `${where.server}.${name}`;
  const channel = where.channel ?? 'internal';
  return CATALOG.list().find(
    (op) => op.contributedBy !== 'plugin' && op.renderings?.[channel]?.includes(rendered) === true,
  );
}

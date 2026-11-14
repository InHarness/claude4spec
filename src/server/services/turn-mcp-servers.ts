/**
 * M44 `317cwhlj` / `3f5ej79s` / `7q3ny9bb` — the turn argument contract: the whole
 * `mcpServers` argument `adapter.execute(...)` receives, assembled by the
 * context-type registry's turn handler from the thread's row.
 *
 * - **Turn servers** = the base set (`skill-tools`, `workspace-tools`) ∪ the
 *   positions of the row's `Serwery` column, each under the condition its owner
 *   holds ({@link SERVER_MOUNT_CONDITIONS}, e.g. "top-level thread only"). A
 *   server outside that sum the turn does not get.
 * - **The pool** for the `pula` position is what the plugin host registers
 *   (`buildMcpServers()`): `entity-tools`, the custom servers of active types and
 *   plugins, and the host's `reference-tools` / `release-tools`. Its assembly
 *   knows no value. A row takes it whole (`pula`) or names pool servers one by
 *   one. On a name collision a base-set or row-named server built by the handler
 *   wins: its pool factory is never built.
 * - **The profile gate** filters the tools by the row's `Klasy operacji` and
 *   drops a server left with no tools.
 *
 * Pure: one function, one result, shared by the `<tooling>` inventory and by
 * every `adapter.execute`, so the set the model is told about and the set it is
 * given cannot differ.
 */

import type { McpServerFactory } from '../../shared/plugin-host/mcp.js';
import { gateServers } from '../operations/profile-gate.js';
import { RUN_TOOLS_SERVER, runToolsMountCondition } from '../mcp/run-tools.js';
import { TRANSAGENT_TOOLS_SERVER, transagentToolsMountCondition } from '../mcp/transagent-tools.js';
import { rowOperationClasses } from './context-types/registry.js';
import { BASE_SERVER_SET, POOL, rowTakesPool, type ContextTypeRow } from './context-types/row.js';

export interface TurnServerEntry {
  name: string;
  server: McpServerFactory;
}

/** Selects pool factories by server name, before any of them is invoked. */
export type PoolSelector = (name: string) => boolean;

/** What a server owner's mount condition reads of the turn. */
export interface TurnMountContext {
  parentThreadId: string | null;
}

/**
 * The mount conditions proper to one server, each held by the server's owner
 * (M46 for orchestration, M55 for Runs). The registry holds no gate of its own.
 */
export const SERVER_MOUNT_CONDITIONS: Readonly<Record<string, (turn: TurnMountContext) => boolean>> = {
  [TRANSAGENT_TOOLS_SERVER]: transagentToolsMountCondition,
  [RUN_TOOLS_SERVER]: runToolsMountCondition,
};

/**
 * The servers a turn of this row may mount, by name: the base set plus the row's
 * named positions, each passing its owner's condition. `pula` is not a name — it
 * is resolved against the pool by {@link poolSelector}.
 */
export function turnServerNames(row: ContextTypeRow, turn: TurnMountContext): Set<string> {
  const out = new Set<string>();
  for (const name of [...BASE_SERVER_SET, ...row.servers]) {
    if (name === POOL) continue;
    const condition = SERVER_MOUNT_CONDITIONS[name];
    if (condition && !condition(turn)) continue;
    out.add(name);
  }
  return out;
}

/**
 * Which pool servers the row takes, as a predicate over the factory NAME: all of
 * them under `pula`, otherwise only those it names. `shadowed` are names a
 * handler entry owns; their pool factory is skipped.
 */
export function poolSelector(
  row: ContextTypeRow,
  named: ReadonlySet<string>,
  shadowed: ReadonlySet<string> = new Set(),
): PoolSelector {
  const whole = rowTakesPool(row);
  return (name) => !shadowed.has(name) && (whole || named.has(name));
}

/**
 * The assembly, in order. `buildPool` builds the host pool restricted to the
 * selector (`ProjectPluginHost.buildMcpServers({ include })`); `handlerServers`
 * are the handler's own builders by name — invoked only for a name the turn
 * mounts, and a builder returning `null` (e.g. `brief-tools` with no
 * `brief_path`) mounts nothing; `pluginServerNames` are the servers whose tools a
 * plugin, not this repo, decided (the gate fails them closed for read-only rows).
 */
export function assembleTurnMcpServers(args: {
  row: ContextTypeRow;
  turn: TurnMountContext;
  buildPool: (include: PoolSelector) => readonly TurnServerEntry[];
  handlerServers: Readonly<Record<string, () => McpServerFactory | null>>;
  pluginServerNames?: ReadonlySet<string>;
  /** 2.1.78 — the plugin servers of a project-local overlay: their declared classes are ignored (`write`). */
  overlayServerNames?: ReadonlySet<string>;
}): TurnServerEntry[] {
  const named = turnServerNames(args.row, args.turn);
  const handlerNames = new Set([...named].filter((n) => Object.prototype.hasOwnProperty.call(args.handlerServers, n)));
  const handlerEntries: TurnServerEntry[] = [];
  for (const name of handlerNames) {
    const server = args.handlerServers[name]!();
    if (server) handlerEntries.push({ name, server });
  }
  // A pool server whose owner condition fails is not mounted from the pool either.
  const blocked = new Set(
    Object.entries(SERVER_MOUNT_CONDITIONS)
      .filter(([, condition]) => !condition(args.turn))
      .map(([name]) => name),
  );
  const merged = [
    ...args.buildPool(poolSelector(args.row, named, new Set([...handlerNames, ...blocked]))),
    ...handlerEntries,
  ];
  return gateServers(rowOperationClasses(args.row), merged, args.pluginServerNames, args.overlayServerNames);
}

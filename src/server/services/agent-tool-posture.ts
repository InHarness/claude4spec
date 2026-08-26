import { PLAN_MODE_DENY_GROUPS, probeToolGating, type ToolGroup } from '@inharness-ai/agent-adapters';
import { readConfig } from '../config.js';

/**
 * 0.2.53 (M18 II): the built-in tool posture of a turn, in one place.
 *
 * Two axes, two lifetimes, ONE union:
 *
 *  - the PROJECT CONSTANT — `agent.disableDirectFilesystemAccess` (default `true`)
 *    denies `file-read` / `file-write` / `shell` for the whole thread;
 *  - the PER-TURN PRESET — `planMode` desugars, inside the library, to
 *    `PLAN_MODE_DENY_GROUPS` (`file-write` + `shell`).
 *
 * The result is a SUM, never a weakening: a project that leaves the flag off does
 * not thereby soften plan mode, and plan mode does not widen access. Both are
 * deny-only, so union is the only composition that can be correct.
 *
 * This function is the single builder every `adapter.execute` call-site uses.
 * No call-site is allowed its own branch — that is the whole point of it living
 * here, beside `resolveAgentExecutionScope`, which resolves the OTHER (path)
 * axis the same way.
 *
 * NOTE — built-ins only. MCP is outside the gating without exception: the
 * library cannot classify opaque MCP tool names, so `reference-tools`,
 * `entity-tools`, `plan-tools`, `release-tools`, `skill-tools`, `c4s-tools` and
 * `transagent-tools` survive a full file+shell deny untouched. That is what
 * makes the default posture workable at all: the spec is still fully readable
 * and writable, just only through core operations.
 */
export const DIRECT_FILESYSTEM_DENY_GROUPS: readonly ToolGroup[] = ['file-read', 'file-write', 'shell'];

export interface ResolveAgentToolGroupsInput {
  cwd: string;
  /** The turn's effective plan-mode flag (thread flag, or forced by the context type). */
  planMode: boolean;
}

export function resolveAgentToolGroups(input: ResolveAgentToolGroupsInput): ToolGroup[] {
  const cfg = readConfig(input.cwd);
  const groups = new Set<ToolGroup>();
  if (cfg.agent.disableDirectFilesystemAccess) {
    for (const g of DIRECT_FILESYSTEM_DENY_GROUPS) groups.add(g);
  }
  if (input.planMode) {
    for (const g of PLAN_MODE_DENY_GROUPS) groups.add(g);
  }
  return [...groups];
}

/**
 * The groups this architecture CANNOT enforce, asked synchronously BEFORE
 * dispatch. A non-empty result must refuse the turn: degradation is a refusal
 * here, not a silently ignored policy. On `claude-code` every group is
 * enforceable (at `soft` strength), so this is defensive — it is what makes the
 * contract real on any other architecture.
 */
export function unenforceableToolGroups(architecture: string, groups: readonly ToolGroup[]): ToolGroup[] {
  if (groups.length === 0) return [];
  return probeToolGating(architecture, groups)
    .filter((report) => !report.enforceable)
    .map((report) => report.group);
}

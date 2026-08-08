import { readConfig } from '../config.js';
import { resolveAgentPathScope } from './agent-path-scope.js';
import type { Root } from '../../shared/types.js';

/**
 * 0.2.8 (A19): the ONE place that composes an agent turn's filesystem scope from
 * config. Every `adapter.execute` call site in the server goes through here — the chat
 * turn (`routes/agent-turn.ts`) and the AC analysis turn
 * (`entities/ac/ac-analysis.service.ts`) — so the implicit artifact deny-set can never
 * again be present on one path and absent on the other.
 *
 * Config is read **per call** (`readConfig` is a pure disk read, no cache), so editing
 * `.claude4spec/config.json` takes effect on the next turn without a process restart.
 * Do NOT hoist this call to service construction time.
 *
 * The path arithmetic itself stays in `resolveAgentPathScope` (roots folding, artifact
 * deny-set, absolute normalization); this module adds only the config read and the
 * `claude_sandbox` shape the adapter expects.
 */
export interface AgentExecutionScope {
  /** Resolved absolute allow-list (root dirs outside cwd + user's `agent.allowedPaths`). */
  allowedPaths: string[];
  /** Resolved absolute deny-list (implicit artifact deny-set ∪ user's `agent.disallowedPaths`). */
  disallowedPaths: string[];
  /** The implicit artifact deny-set alone (subset of `disallowedPaths`), for the prompt block. */
  artifactDenyDirs: string[];
  /** Raw `agent.allowedPaths` from config — the soft (prompt) layer renders these verbatim. */
  userAllowedPaths: string[];
  /** Raw `agent.disallowedPaths` from config — same. */
  userDisallowedPaths: string[];
  /** 0.2.13 item 28: the page roots, denied for WRITE only. Rendered in the prompt block too. */
  pageRootDirs: string[];
  /**
   * The hard layer: `architectureConfig.claude_sandbox`.
   *
   * `denyRead` and `denyWrite` were the same list until 0.2.13, and for the artifact dirs
   * they still are: an artifact dir the agent may not hand-edit is also one it should not
   * read around the MCP tools, because those tools serve every read of it.
   *
   * Item 28 is what splits them. A page must stay READABLE by the built-in tools — no
   * operation hands back raw page markdown for a `Grep`-style prose sweep, and the M05
   * prompt tells the agent to run exactly that sweep — while its WRITE channel has to
   * close, so `create_page` / `update_page` / `delete_page` / `update_section` become the
   * only path. Symmetric denial would have bought the block at the cost of the agent's
   * ability to find anything.
   *
   * ## MEASURED, 0.2.13: on a host WITH an OS sandbox this list is not enforced at all
   *
   * Do not read the field names as a guarantee. `agent-adapters` branches on
   * `pathScope.strength`, and the two arms are the opposite way round from what one would
   * assume:
   *
   *   - `strength === 'soft'` (no seatbelt/bubblewrap) → `permissionMode: 'dontAsk'` plus
   *     real `settings.permissions.deny` rules built from `disallowedPaths`. This works.
   *   - `strength === 'hard'` → `permissionMode: 'bypassPermissions'`,
   *     `allowDangerouslySkipPermissions: true`, NO deny rules, and the lists handed to
   *     `options.sandbox.filesystem` instead — which the Agent SDK documents as NOT the
   *     filesystem restriction mechanism ("Filesystem access: use Read and Edit permission
   *     rules"; the sandbox settings control sandbox BEHAVIOUR). So nothing gates the
   *     filesystem.
   *
   * Verified by running it: on macOS (seatbelt present) a chat turn wrote both
   * `pages/probe.md` AND `.claude4spec/entities/probe-artifact.md` with the built-in
   * `Write`, unrefused. The second one is the 0.1.130 artifact hard-lock, which predates
   * this release by a long way — so this is a pre-existing gap that item 28 inherits, not
   * one it introduces, and it cannot be closed from this module: expressing "deny write,
   * allow read" needs an API `disallowedPaths` does not have (it renders as a symmetric
   * Read+Edit+Write triple).
   *
   * Until the vendor side is fixed, the effective gate on a developer machine is the
   * `<agent_path_scope>` prompt block. Filed as a patch against the brief; keep this list
   * correct so the block starts working the moment that lands.
   */
  claudeSandbox: {
    enabled: true;
    filesystem: { denyRead: string[]; denyWrite: string[]; allowWrite: string[] };
  };
}

export interface ResolveAgentExecutionScopeInput {
  cwd: string;
  /**
   * 0.1.96 multiroot: the project's effective page roots. Boot config plus the CLI
   * `--pages` override, so it is NOT always `readConfig(cwd).roots` — callers must pass
   * the same list the rest of the project uses (`ProjectContext.roots`).
   */
  roots: Root[];
}

export function resolveAgentExecutionScope(
  input: ResolveAgentExecutionScopeInput,
): AgentExecutionScope {
  const cfg = readConfig(input.cwd);
  const userAllowedPaths = cfg.agent?.allowedPaths ?? [];
  const userDisallowedPaths = cfg.agent?.disallowedPaths ?? [];
  const scope = resolveAgentPathScope({
    cwd: input.cwd,
    roots: input.roots,
    allowedPaths: userAllowedPaths,
    disallowedPaths: userDisallowedPaths,
    plansDir: cfg.plansDir,
    briefsDir: cfg.briefsDir,
    patchesDir: cfg.patchesDir,
    entitiesDir: cfg.entitiesDir,
    releasesDir: cfg.releasesDir,
  });
  return {
    ...scope,
    userAllowedPaths,
    userDisallowedPaths,
    claudeSandbox: {
      enabled: true,
      filesystem: {
        denyRead: scope.disallowedPaths,
        denyWrite: [...scope.disallowedPaths, ...scope.pageRootDirs],
        allowWrite: scope.allowedPaths,
      },
    },
  };
}

/**
 * 0.2.8 (C15): canonical form of a path list for the resume-lock comparison.
 *
 * `findResumeViolations` compares by `JSON.stringify`, i.e. order-sensitively. The
 * resolver's output order follows the config file's order, so merely reordering the same
 * entries in Settings would otherwise raise a bogus `RESUME_CONFIG_LOCKED`. Sorting +
 * deduping here makes the comparison a set comparison, which is what the scope actually
 * is. Apply to BOTH sides: the snapshot written on turn 1 and the current turn's scope.
 */
export function normalizeResumePathScope(paths: string[]): string[] {
  return [...new Set(paths)].sort();
}

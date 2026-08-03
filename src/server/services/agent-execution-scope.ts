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
  /**
   * The hard layer: `architectureConfig.claude_sandbox`. `denyRead` and `denyWrite` are
   * deliberately the same list — an artifact dir the agent may not hand-edit is also one
   * it should not read around the MCP tools.
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
        denyWrite: scope.disallowedPaths,
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

import path from 'node:path';
import type { Root } from '../../shared/types.js';

/**
 * 0.1.90 (M05): resolve the chat agent's effective filesystem path scope for a turn.
 *
 * The implicit base — `cwd` ∪ (each `roots[].dir` that lies outside `cwd`) — is what the
 * agent already sees by default. `cwd` itself is NOT returned in `allowedPaths`: the
 * agent-adapters library adds the base (`cwd`) on its own, so doubling it here would be
 * redundant. We DO add each root dir that sits outside `cwd`, because the library's base
 * is only `cwd`.
 *
 * Precedence is enforced downstream (deny > allow > base), by the library's native sandbox
 * for the hard layer and by the `<agent_path_scope>` prompt block for the soft layer. This
 * resolver's job is purely to (a) fold every root dir into the allow-list and (b) normalize
 * every entry to an absolute path (relative entries resolve against `cwd`), so only absolute
 * paths reach `adapter.execute`.
 */
export interface ResolveAgentPathScopeInput {
  cwd: string;
  /** 0.1.96 multiroot: every configured page root; each `dir` folds into the base allow-list. */
  roots: Root[];
  allowedPaths: string[];
  disallowedPaths: string[];
}

export interface ResolvedAgentPathScope {
  allowedPaths: string[];
  disallowedPaths: string[];
}

function toAbs(cwd: string, p: string): string {
  return path.resolve(cwd, p); // absolute `p` is returned as-is (normalized) by path.resolve
}

/** True when `child` is the same as or nested under `parent` (both absolute). */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function dedupe(paths: string[]): string[] {
  return [...new Set(paths)];
}

export function resolveAgentPathScope(input: ResolveAgentPathScopeInput): ResolvedAgentPathScope {
  const cwdAbs = path.resolve(input.cwd);

  // Base extras: each root dir only when it falls outside cwd (inside-cwd is already
  // covered by the library's implicit `cwd` base). cwd itself is intentionally NOT added.
  const baseExtras = input.roots
    .map((r) => toAbs(cwdAbs, r.dir))
    .filter((rootAbs) => !isInside(cwdAbs, rootAbs));

  const allowedPaths = dedupe([...baseExtras, ...input.allowedPaths.map((p) => toAbs(cwdAbs, p))]);
  const disallowedPaths = dedupe(input.disallowedPaths.map((p) => toAbs(cwdAbs, p)));

  return { allowedPaths, disallowedPaths };
}

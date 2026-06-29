import path from 'node:path';

/**
 * 0.1.90 (M05): resolve the chat agent's effective filesystem path scope for a turn.
 *
 * The implicit base — `cwd` ∪ (`pagesDir` when it lies outside `cwd`) — is what the
 * agent already sees by default. `cwd` itself is NOT returned in `allowedPaths`: the
 * agent-adapters library adds the base (`cwd`) on its own, so doubling it here would be
 * redundant. We DO add `pagesDir` when it sits outside `cwd`, because the library's base
 * is only `cwd`.
 *
 * Precedence is enforced downstream (deny > allow > base), by the library's native sandbox
 * for the hard layer and by the `<agent_path_scope>` prompt block for the soft layer. This
 * resolver's job is purely to (a) fold `pagesDir` into the allow-list and (b) normalize every
 * entry to an absolute path (relative entries resolve against `cwd`), so only absolute paths
 * reach `adapter.execute`.
 */
export interface ResolveAgentPathScopeInput {
  cwd: string;
  pagesDir: string;
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
  const pagesAbs = toAbs(cwdAbs, input.pagesDir);

  // Base extra: pagesDir only when it falls outside cwd (inside-cwd is already covered
  // by the library's implicit `cwd` base). cwd itself is intentionally NOT added.
  const baseExtras = isInside(cwdAbs, pagesAbs) ? [] : [pagesAbs];

  const allowedPaths = dedupe([...baseExtras, ...input.allowedPaths.map((p) => toAbs(cwdAbs, p))]);
  const disallowedPaths = dedupe(input.disallowedPaths.map((p) => toAbs(cwdAbs, p)));

  return { allowedPaths, disallowedPaths };
}

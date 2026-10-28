// Directories that are never worth watching and routinely contain thousands
// of files — descending into them costs an observation per directory on
// systems without native recursive watching, and floods a recursive stream.
// (Dot-dirs such as `.git`, `.next`, `.cache` are covered by the dot-segment rule.)
const HEAVY_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out']);

/**
 * 2.1.60 (M40 `vfyffo9a`) — the excluded subtrees a source's OWNER declares when
 * it mounts the source, as the `exclude` predicate of `mountSource`. `relPath`
 * is relative to the mount dir, so the mount dir itself is never excluded, even
 * when its own absolute path runs through `node_modules` (a plugin's `dist`) or
 * a dot-dir (`.claude4spec/plugins`).
 *
 * Every subtree passing through a dot-segment — the namespace of a registry
 * root (M02 `l13model0`), which also hides the record store's dot-prefixed
 * temp files — and every heavy build/dependency directory.
 *
 * ASSUMPTION:dev-0001 — the namespace of a registry root excludes only
 * dot-segment subtrees; the heavy directories are excluded on top of it, as
 * every mount did before 2.1.60, so a root at `.` does not observe
 * `node_modules`.
 */
export function isExcludedSubtree(relPath: string): boolean {
  return relPath.split('/').some((seg) => seg.startsWith('.') || HEAVY_DIRS.has(seg));
}

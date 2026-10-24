/**
 * Map absolute paths onto mounted sources.
 *
 * A path inside a mount's dir belongs to that source under its mount-relative,
 * `/`-separated relPath — the same form the runtime derives from an fs event.
 * Paths and dirs are compared by realpath, so a symlinked dir (e.g. macOS
 * `/var` → `/private/var`) and git's real worktree root still match. A path
 * may not exist yet (added by the change) or any more (deleted) — its nearest
 * existing ancestor is resolved. A path inside two mounts (nested dirs) maps to
 * both; a path inside none maps to nothing.
 *
 * Shared by the two callers that receive a set of absolute paths from git and
 * must address the runtime's `(scope, source, relPath)` keys: origin labelling
 * of a HEAD change (`head-change-origin.ts`) and the operation suppression of
 * `FileWatchRuntime.suppressOperation`.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface MountedDir {
  /** The source name the mount was registered under (e.g. `pages:pages`). */
  source: string;
  /** The mount's absolute dir. */
  dir: string;
}

export function mountRelPaths(
  absPaths: readonly string[],
  mounts: readonly MountedDir[],
): Array<{ source: string; relPath: string }> {
  const out: Array<{ source: string; relPath: string }> = [];
  if (absPaths.length === 0 || mounts.length === 0) return out;
  const resolved = mounts.map((m) => ({ source: m.source, dir: realpathOfNearestAncestor(m.dir) }));
  for (const abs of absPaths) {
    const real = realpathOfNearestAncestor(abs);
    if (!real) continue;
    for (const m of resolved) {
      if (!m.dir) continue;
      const rel = path.relative(m.dir, real);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
      out.push({ source: m.source, relPath: rel.split(path.sep).join('/') });
    }
  }
  return out;
}

/** `realpath` of `p`, tolerating a missing tail (re-appended to the nearest existing ancestor). */
function realpathOfNearestAncestor(p: string): string | null {
  const tail: string[] = [];
  let current = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

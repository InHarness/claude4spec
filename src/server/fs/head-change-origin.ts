/**
 * 2.1.10 (M40 j37qjvvh) — origin labelling for a HEAD change made from the app
 * (M28 `checkout()` and `sync()`).
 *
 * Git rewrites files the server did not write byte for byte, so the reaction
 * chain must run from the `watcher` trigger (only it sees those files) while
 * the UI must not show a "changed externally" dialog. The caller labels the
 * whole set of paths differing between the old and the new HEAD BEFORE HEAD
 * moves, on the CURRENT context instance — tokens are keyed per instance
 * (`(scope, source, relPath)`), so labelling after the rebuild would hit the
 * successor's key, which those events no longer concern. `suppress` is not
 * used: the chain has to run over the changed files.
 *
 * This maps absolute paths onto the context's mounted sources: a path inside
 * a mount's dir is labelled under that source with its mount-relative,
 * `/`-separated relPath (the same form the runtime derives from an fs event).
 * Paths and dirs are compared by realpath, so a symlinked dir (e.g. macOS
 * `/var` → `/private/var`) and git's real worktree root still match. A path
 * may not exist yet (added by the change) or any more (deleted) — its nearest
 * existing ancestor is resolved.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { WatchActor } from './watcher.js';

export interface HeadChangeMount {
  /** The source name the mount was registered under (e.g. `pages:pages`). */
  source: string;
  /** The mount's absolute dir. */
  dir: string;
}

/** The part of a scoped registrar this needs — the context's own `markOrigin`. */
export interface OriginLabeller {
  markOrigin(source: string, relPath: string, actor: WatchActor): void;
}

/**
 * Build the `markHeadChangeOrigin` callback `GitService` takes: every absolute
 * path that lies inside one of `mounts()` is labelled `origin: 'server'`
 * (actor `user` — the sidebar action is the user's) on `registrar`.
 * `mounts` is read on every call, so mounts added after construction count.
 */
export function headChangeOriginMarker(
  registrar: OriginLabeller,
  mounts: () => readonly HeadChangeMount[],
  actor: WatchActor = 'user',
): (absPaths: string[]) => void {
  return (absPaths) => {
    const resolved = mounts().map((m) => ({ source: m.source, dir: realpathOfNearestAncestor(m.dir) }));
    for (const abs of absPaths) {
      const real = realpathOfNearestAncestor(abs);
      if (!real) continue;
      for (const m of resolved) {
        if (!m.dir) continue;
        const rel = path.relative(m.dir, real);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
        registrar.markOrigin(m.source, rel.split(path.sep).join('/'), actor);
      }
    }
  };
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

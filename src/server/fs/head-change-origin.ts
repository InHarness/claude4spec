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
 * Absolute paths are mapped onto the context's mounted sources by
 * `mountRelPaths` (`mount-paths.ts`).
 */

import type { WatchActor } from './watcher.js';
import { mountRelPaths, type MountedDir } from './mount-paths.js';

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
  mounts: () => readonly MountedDir[],
  actor: WatchActor = 'user',
): (absPaths: string[]) => void {
  return (absPaths) => {
    for (const { source, relPath } of mountRelPaths(absPaths, mounts())) {
      registrar.markOrigin(source, relPath, actor);
    }
  };
}

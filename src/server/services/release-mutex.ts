/**
 * 2.1.47 (M17 L2 `g4rsukyw`) — the release mutex, one per project.
 *
 * Every operation that assigns versions to a release takes it: `createRelease`
 * (with its commit-on-release), `updateRelease` with `assignUnreleased: true`
 * (with its "pull" commit) and the shadow acceptance — and holds it from the
 * transaction to the end of the commit. On a taken mutex an operation WAITS,
 * the way release operations wait for the repository lock. The order is fixed:
 * the release mutex BEFORE the repository lock, so there is no deadlock.
 *
 * It exists because the repository lock does not cover the release
 * transaction: without it a release created from another thread during an
 * acceptance would take the shadow's version rows, and its file would ride in
 * the acceptance commit.
 *
 * Keyed by the project's directory and kept in the process, like the
 * repository lock — a rebuild of the project context (a new `ReleaseService`)
 * must not hand out a second, free mutex while the first one's holder runs.
 */

import nodePath from 'node:path';

export class ReleaseMutex {
  private tail: Promise<void> = Promise.resolve();

  /** Wait for the mutex, run `fn`, release it whether `fn` resolves or rejects. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const turn = this.tail.then(fn);
    // The next waiter starts after this one settles, never on its rejection.
    this.tail = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }
}

const mutexes = new Map<string, ReleaseMutex>();

/** The release mutex of the project rooted at `cwd`. */
export function releaseMutexFor(cwd: string): ReleaseMutex {
  const key = nodePath.resolve(cwd);
  let mutex = mutexes.get(key);
  if (!mutex) {
    mutex = new ReleaseMutex();
    mutexes.set(key, mutex);
  }
  return mutex;
}

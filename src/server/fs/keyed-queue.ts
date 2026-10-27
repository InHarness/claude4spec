/**
 * Per-key write queue — the one in-process critical section the file-backed
 * services take around a read-modify-write of one path (`RecordStore`,
 * `PlanService`, `BriefService`, `PatchService`). The filesystem gives no
 * transaction, and one server process is all that writes, so chained promises
 * are enough.
 *
 * Two rules:
 * - a predecessor that threw still releases the key: the next caller runs
 *   regardless (`then(fn, fn)`), so "the second writer sees what the first
 *   left" holds even when the first refused;
 * - only the tail of a key's queue clears its entry once it settles, so the map
 *   holds a key only while work on it is queued — it does not grow by one entry
 *   per path ever written.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(key) ?? Promise.resolve();
    const run = prior.then(fn, fn);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, settled);
    try {
      return await run;
    } finally {
      if (this.tails.get(key) === settled) this.tails.delete(key);
    }
  }

  /** Number of keys with queued or running work. */
  get size(): number {
    return this.tails.size;
  }
}

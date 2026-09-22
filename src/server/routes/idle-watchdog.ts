/**
 * The turn's idle watchdog (0.2.107) — OUR clock, because the library exposes
 * no way to extend its own `timeoutMs` (see `TURN_TIMEOUT_MS`).
 *
 * `kick()` re-arms a full window on every sign of life. `pause()` stops the
 * clock for as long as a human is being asked something and returns the
 * matching resume; pauses are COUNTED, so two open questions keep the clock
 * stopped until both are settled, and the last resume re-arms a full window
 * (the time spent waiting on a human is not the agent's silence).
 *
 * `extend(ms)` lengthens the window while something slower is legitimately
 * in charge — a bubble child with its own, equal clock (M46): the parent waits
 * one margin longer so the child's watchdog fires first.
 *
 * OUTSTANDING WORK (`open`/`close`) — the idle clock counts only while the set
 * of outstanding work is EMPTY. Silence while something the agent started is
 * still open (a foreground tool call between its `tool_use` and `tool_result`)
 * is that work being slow, not the agent going silent. While the set is
 * non-empty the window is `outstandingCapMs` instead — a ceiling on how long
 * outstanding work may run without a sign of life, so a wedged tool still ends
 * the turn long before the 24 h backstop. `onExpire` is told which clock fired.
 *
 * Deliberately knows nothing about adapters: `onExpire` is the whole policy.
 * Once expired or stopped, every further call is a no-op — a late event from a
 * turn already being torn down must not resurrect the timer.
 */
/** `idle` — silence with nothing outstanding; `outstanding` — open work hit its ceiling. */
export type IdleClock = 'idle' | 'outstanding';

export class IdleWatchdog {
  private timer: NodeJS.Timeout | null = null;
  private pauses = 0;
  private extraMs = 0;
  private done = false;
  private readonly outstanding = new Set<string>();

  constructor(
    readonly timeoutMs: number,
    private readonly onExpire: (clock: IdleClock) => void,
    readonly outstandingCapMs: number = timeoutMs,
  ) {}

  /** Start (or restart) the clock — a sign of life. Ignored while paused. */
  kick(): void {
    if (this.done || this.pauses > 0) return;
    this.clear();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.done || this.pauses > 0) return;
      this.done = true;
      this.onExpire(this.clock);
    }, this.windowMs);
    // A turn's clock must never be what keeps the process alive.
    this.timer.unref?.();
  }

  /** Stop the clock until the returned function is called (idempotent). */
  pause(): () => void {
    if (this.done) return () => {};
    this.pauses += 1;
    this.clear();
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      this.pauses -= 1;
      if (this.pauses === 0) this.kick();
    };
  }

  /** Lengthen the window by `ms` until the returned function is called (idempotent). */
  extend(ms: number): () => void {
    if (this.done) return () => {};
    this.extraMs += ms;
    this.kick();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.extraMs -= ms;
      this.kick();
    };
  }

  /** Work `key` has started — the idle clock stops counting until it closes. */
  open(key: string): void {
    if (this.done) return;
    this.outstanding.add(key);
    this.kick();
  }

  /** Work `key` is done (unknown keys are ignored). */
  close(key: string): void {
    if (this.done || !this.outstanding.delete(key)) return;
    this.kick();
  }

  /** Drop every open item — the turn's own work is over (e.g. its `result`). */
  closeAll(): void {
    if (this.done || this.outstanding.size === 0) return;
    this.outstanding.clear();
    this.kick();
  }

  /** Which clock is counting: idle with nothing outstanding, the ceiling otherwise. */
  get clock(): IdleClock {
    return this.outstanding.size > 0 ? 'outstanding' : 'idle';
  }

  get outstandingCount(): number {
    return this.outstanding.size;
  }

  /** The window currently in force: the clock's base plus open extensions. */
  get windowMs(): number {
    return (this.clock === 'outstanding' ? this.outstandingCapMs : this.timeoutMs) + this.extraMs;
  }

  get paused(): boolean {
    return this.pauses > 0;
  }

  /** The turn is over — disarm for good. */
  stop(): void {
    this.done = true;
    this.clear();
  }

  private clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

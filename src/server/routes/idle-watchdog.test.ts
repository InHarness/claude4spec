import { describe, it, expect, vi, afterEach } from 'vitest';
import { IdleWatchdog } from './idle-watchdog.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('IdleWatchdog (0.2.107)', () => {
  it('fires once after a full window of silence', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const w = new IdleWatchdog(1_000, onExpire);
    w.kick();
    vi.advanceTimersByTime(999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    // Expired is final — a late event must not resurrect the clock.
    w.kick();
    vi.advanceTimersByTime(5_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('re-arms a full window on every kick', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const w = new IdleWatchdog(1_000, onExpire);
    w.kick();
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(900);
      w.kick();
    }
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('stays stopped while paused, counts nested pauses, and re-arms a full window on the last resume', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const w = new IdleWatchdog(1_000, onExpire);
    w.kick();
    const resumeA = w.pause();
    const resumeB = w.pause();
    w.kick(); // a sign of life during a pause does not restart the clock
    vi.advanceTimersByTime(60_000);
    expect(onExpire).not.toHaveBeenCalled();
    resumeA();
    resumeA(); // idempotent
    vi.advanceTimersByTime(60_000);
    expect(onExpire).not.toHaveBeenCalled();
    resumeB();
    vi.advanceTimersByTime(999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('lengthens the window while extended, and restores it on release', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const w = new IdleWatchdog(1_000, onExpire);
    const release = w.extend(300);
    expect(w.windowMs).toBe(1_300);
    vi.advanceTimersByTime(1_299);
    expect(onExpire).not.toHaveBeenCalled();
    release();
    expect(w.windowMs).toBe(1_000);
    vi.advanceTimersByTime(999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('never fires after stop()', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const w = new IdleWatchdog(1_000, onExpire);
    w.kick();
    w.stop();
    w.kick();
    vi.advanceTimersByTime(10_000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});

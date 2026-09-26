import { useSyncExternalStore } from 'react';
import { formatElapsed } from './elapsed.js';

/**
 * One shared 1 s ticker for every clock on screen: a turn with a few running
 * subagents and background tasks would otherwise run one interval per card,
 * each re-rendering on its own phase (the seconds would flip at different
 * moments). The interval exists only while at least one clock is mounted.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let tickNow = Date.now();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer == null) {
    tickNow = Date.now();
    timer = setInterval(() => {
      tickNow = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getNow = () => tickNow;

/**
 * Ticks once a second: `Date.now() - startMs`, formatted. No clock-skew
 * correction — the server is local, on the same machine as the client.
 * Null while there is no start.
 */
export function useElapsed(startMs: number | null | undefined): string | null {
  const now = useSyncExternalStore(subscribe, getNow, getNow);
  return startMs == null ? null : formatElapsed(now - startMs);
}

/**
 * The clock as a span. Deliberately NOT a live region: a `polite` region updated
 * every second would flood a screen reader, so ticks are never announced.
 */
export function ElapsedClock({ startMs, className }: { startMs: number | null | undefined; className?: string }) {
  const text = useElapsed(startMs);
  if (text == null) return null;
  return (
    <span data-elapsed-clock="" className={`tabular-nums ${className ?? ''}`.trim()}>
      {text}
    </span>
  );
}

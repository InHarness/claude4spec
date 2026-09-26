import { useEffect, useState } from 'react';
import { formatElapsed } from './elapsed.js';

/**
 * Ticks once a second: `Date.now() - startMs`, formatted. No clock-skew
 * correction — the server is local, on the same machine as the client.
 * Null while there is no start.
 */
export function useElapsed(startMs: number | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startMs == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startMs]);
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

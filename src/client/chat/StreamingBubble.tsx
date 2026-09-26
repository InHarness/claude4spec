import { ElapsedClock } from './ElapsedClock.js';

/**
 * When the bubble shows: the turn is open locally or a join is resuming it, AND
 * it is not parked. Parking swaps it for the busy indicator, which needs the
 * opposite — the two are never on screen together.
 */
export function streamingBubbleVisible(s: { isStreaming: boolean; isResuming: boolean; isParked: boolean }): boolean {
  return (s.isStreaming || s.isResuming) && !s.isParked;
}

/**
 * M05: the `streaming` bubble — `streaming · 1:23`. Shown while the turn is open
 * and not parked (the caller decides); parking swaps it for the busy indicator.
 *
 * 0.2.114: the turn clock sits NEXT TO the `aria-live` region, never inside it —
 * a polite region re-rendered every second would flood a screen reader. The
 * region's own attributes are unchanged. `turnStartedAt` null (a joiner before
 * the replayed `turn_start`) → no clock.
 */
export function StreamingBubble({ turnStartedAt }: { turnStartedAt: number | null }) {
  return (
    <div className="msg-enter mb-3 flex">
      <div
        className="inline-flex items-center gap-1.5 py-1 text-[10.5px] font-mono"
        style={{ color: 'var(--c-muted)' }}
      >
        <div className="inline-flex items-center gap-1.5" aria-live="polite" aria-label="Agent is streaming">
          <span className="dot-pulse">
            <span></span>
            <span></span>
            <span></span>
          </span>
          <span className="uppercase tracking-wider">streaming</span>
        </div>
        {turnStartedAt != null && (
          <>
            <span aria-hidden="true">·</span>
            <ElapsedClock startMs={turnStartedAt} />
          </>
        )}
      </div>
    </div>
  );
}

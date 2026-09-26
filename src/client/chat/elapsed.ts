/**
 * 0.2.114: the work clock shared by the streaming bubble, the subagent card, the
 * background-task row and the transagent panel header. `m:ss`, from an hour on
 * `h:mm:ss`; negative spans (a start a hair in the future) read as zero.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * A server timestamp as epoch ms. SQLite's `datetime('now')` comes back raw —
 * `YYYY-MM-DD HH:MM:SS`, UTC with no `T` and no zone — and `Date.parse` would
 * read that as LOCAL time, so it is normalised to ISO UTC first. A value that
 * already carries `T` / a zone passes through as is. Unparseable → null.
 */
export function parseServerTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

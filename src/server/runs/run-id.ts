import { randomBytes } from 'node:crypto';

/**
 * M55 `d8r8kkrd` — the runId is the master's: a ULID in lower case, matching
 * the runner's pattern (`c4s-runner` `modules/M04-git-gateway.md` #pzazv7x0,
 * `[a-z0-9][a-z0-9-]{7,63}`). Every `run_remote` call mints a new one; an old
 * runId is never reused for a changed order.
 *
 * 26 characters of Crockford base32: 10 for the millisecond timestamp, 16 for
 * 80 random bits.
 */
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

/** The runner's pattern for a runId. */
export const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

export function newRunId(now: number = Date.now()): string {
  let time = '';
  let t = Math.max(0, Math.floor(now));
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let random = '';
  for (let i = 0; i < 16; i++) random += CROCKFORD[bytes[i]! % 32];
  return time + random;
}

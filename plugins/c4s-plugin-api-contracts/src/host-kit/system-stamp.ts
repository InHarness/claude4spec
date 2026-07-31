/**
 * Vendored twin of `src/server/entities/system-stamp.ts` (0.2.4).
 *
 * Kept in the host-kit for the same reason `mutate-opts.ts` is: a plugin's
 * services must resolve their timestamps by exactly the host's rule, and the
 * plugin cannot import from the host's source tree. Keep the two in step —
 * they are one rule, written twice.
 */

import type { MutateOpts, SystemStamp } from './mutate-opts.js';

export type { SystemStamp };

/**
 * 0.2.4 — THE default `ORDER BY` for an entity list, shared by every service.
 * Ascending, `slug`-tiebroken, identical on REST/UI/MCP/CLI. See the host's
 * `src/server/entities/system-stamp.ts` for the full rationale.
 */
export const ENTITY_LIST_ORDER = 'created_at, slug';

/** The columns `resolveStamp` reads off the pre-update row. */
export interface StampedRow {
  created_at?: unknown;
}

/** ISO-8601 with milliseconds, UTC — the one format the write path agrees on. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Normalize a stored timestamp. Idempotent. Legacy values came from SQLite's
 * `datetime('now')` (`YYYY-MM-DD HH:MM:SS`, UTC, no zone marker) — that form is
 * parsed as LOCAL time by `new Date`, so the `Z` is appended before parsing.
 */
export function toIsoMs(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const raw = value.trim();
  const sqlite = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(raw);
  const candidate = sqlite ? `${sqlite[1]}T${sqlite[2]}Z` : raw;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Decide the stamp for one mutation: `opts.stamp` verbatim when present,
 * else preserve `existing.created_at` on an update, else mint both on a create.
 */
export function resolveStamp(
  type: string,
  opts?: MutateOpts,
  existing?: StampedRow | null,
): SystemStamp {
  if (opts?.stamp) return opts.stamp;

  // No `writeFile: false` warning — see the host original for why the predicate
  // cannot carry that meaning (`HostEntityWriter` sets it on every path).
  const now = nowIso();
  if (!existing) return { createdAt: now, updatedAt: now };
  return { createdAt: toIsoMs(existing.created_at) ?? now, updatedAt: now };
}

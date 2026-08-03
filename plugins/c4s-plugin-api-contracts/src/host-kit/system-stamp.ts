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

/** Read the envelope off a snapshot. Null when either half is missing/unparseable. */
function readSystemFields(data: unknown): SystemStamp | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const createdAt = toIsoMs(record.createdAt);
  const updatedAt = toIsoMs(record.updatedAt);
  if (!createdAt || !updatedAt) return null;
  return { createdAt, updatedAt };
}

/** The two `EntityStore` methods `existingStampFromFile` needs. */
export interface EntityFileProbe {
  exists(type: string, slug: string): boolean;
  read(type: string, slug: string): unknown;
}

/**
 * 0.2.7 — read the pre-update `createdAt` off the ENTITY FILE, never off the
 * SQLite row: the row is a projection of the file, so sourcing `createdAt` from
 * it reverses the direction of flow and the next `persist` writes the divergence
 * back into the file. Null when there is no usable file — the caller falls back
 * to the row. Pass the INCOMING slug; on a rename the file is still at the old
 * one. See the host's `src/server/entities/system-stamp.ts` for the full
 * rationale.
 */
export function existingStampFromFile(
  store: EntityFileProbe,
  type: string,
  slug: string,
): StampedRow | null {
  try {
    if (!store.exists(type, slug)) return null;
    const stamp = readSystemFields(store.read(type, slug));
    return stamp ? { created_at: stamp.createdAt } : null;
  } catch {
    return null;
  }
}

/**
 * `resolveStamp` for the UPDATE path: file first, row as fallback — and the file
 * read is SKIPPED when `opts.stamp` is present (the reindex path), which would
 * otherwise re-read and re-parse every entity file inside the rebuild
 * transaction to produce a value `resolveStamp` discards on its first line.
 */
export function resolveStampForUpdate(
  type: string,
  opts: MutateOpts | undefined,
  store: EntityFileProbe,
  slug: string,
  current: StampedRow | null | undefined,
): SystemStamp {
  if (opts?.stamp) return opts.stamp;
  return resolveStamp(type, opts, existingStampFromFile(store, type, slug) ?? current);
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

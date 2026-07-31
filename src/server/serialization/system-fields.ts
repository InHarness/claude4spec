/**
 * 0.2.4 — `createdAt`/`updatedAt` are FILE fields, and this module is the only
 * clock in the entity write path.
 *
 * Before this, every entity service stamped `updated_at = datetime('now')` on
 * every write, and the boot rebuild is a write: reindexing an unchanged file
 * moved its timestamp. `updatedAt` in a version diff therefore meant "the
 * indexer ran", not "the content changed", and `ORDER BY created_at` reshuffled
 * itself on restart. Moving the value into the file inverts the direction —
 * the file is the source, the columns are its projection, rewritten verbatim on
 * every rebuild.
 *
 * The envelope is FLAT and top-level on `SnapshotData` (`{createdAt, updatedAt,
 * ...payload}`). That is safe because no serializer emits either key today; the
 * host attaches and detaches them at the three chokepoints in `snapshot.ts`, so
 * no per-type code ever sees them.
 */

/** The two timestamps an entity file carries, ISO-8601 with milliseconds, UTC. */
export interface SystemStamp {
  createdAt: string;
  updatedAt: string;
}

/** The two envelope keys, as they appear in the file and in a snapshot. */
export const SYSTEM_FIELD_KEYS = ['createdAt', 'updatedAt'] as const;

/** Now, in the one format the whole write path agrees on. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Normalize a stored timestamp to `nowIso()`'s format. IDEMPOTENT: an already
 * normalized value is returned unchanged, so this can sit on a read path that
 * sees both shapes at once.
 *
 * Values written before 0.2.4 came from SQLite's `datetime('now')`, which
 * renders `YYYY-MM-DD HH:MM:SS` in UTC with no zone marker and no milliseconds.
 * Fed to `new Date(...)` as-is, that string is parsed as LOCAL time by the
 * ES spec's date-time forms, silently shifting every legacy timestamp by the
 * host's offset — so the `Z` is appended before parsing rather than after.
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
export function readSystemFields(data: unknown): SystemStamp | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const createdAt = toIsoMs(record.createdAt);
  const updatedAt = toIsoMs(record.updatedAt);
  if (!createdAt || !updatedAt) return null;
  return { createdAt, updatedAt };
}

/**
 * Return a copy of `data` carrying the envelope. Non-object snapshots (a type
 * whose serializer returns a scalar or an array) are passed through untouched —
 * there is nowhere to put the keys, and inventing a wrapper would change the
 * file shape for that type.
 */
export function attachSystemFields<T>(data: T, stamp: SystemStamp | null | undefined): T {
  if (!stamp) return data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  return { ...(data as Record<string, unknown>), createdAt: stamp.createdAt, updatedAt: stamp.updatedAt } as T;
}

/**
 * Return a copy of `data` with the envelope removed. Used on the restore path
 * (the per-type slot must see exactly what it saw before 0.2.4) and on BOTH
 * sides of a diff — which is what makes a stamp-only delta structurally `noop`
 * for every type at once, rather than per-serializer.
 */
export function stripSystemFields<T>(data: T): T {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  if (!('createdAt' in record) && !('updatedAt' in record)) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'createdAt' || key === 'updatedAt') continue;
    out[key] = value;
  }
  return out as T;
}

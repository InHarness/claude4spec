/**
 * 0.2.4 — the one rule every entity service uses to decide what goes into its
 * `created_at` / `updated_at` columns.
 *
 * Six services used to answer this question six times, all the same way and all
 * wrong in the same way: `updated_at = datetime('now')`. That made the column
 * authoritative and the file derived. Now the file is authoritative, so a
 * service's job is no longer to invent a value — it is to write down the one
 * the caller supplies, and to mint one only when there is genuinely no file
 * behind the write.
 */

import { nowIso, readSystemFields, toIsoMs, type SystemStamp } from '../serialization/system-fields.js';
import type { MutateOpts } from './mutate-opts.js';

/**
 * 0.2.4 — THE default `ORDER BY` for an entity list, shared by every service.
 *
 * Ordering by `created_at` only became meaningful once the file owned the
 * value: before, it was re-minted on every index pass, so `ORDER BY created_at`
 * reshuffled itself at boot and each service had picked its own column to avoid
 * that (`name`, `slug`, `path, method`). One constant, one order — the same one
 * `RawEntityReader.orderClause` produces, so a list looks identical whether it
 * came through REST, the UI, MCP or the CLI.
 *
 * ASCENDING (presentation order, not ranking order) and `slug`-tiebroken, which
 * is what keeps `LIMIT`/`OFFSET` paging from losing or duplicating rows when
 * two entities share a timestamp.
 */
export const ENTITY_LIST_ORDER = 'created_at, slug';

/** The columns `resolveStamp` reads off the pre-update row. */
export interface StampedRow {
  created_at?: unknown;
}

/** The two `EntityStore` methods `existingStampFromFile` needs. */
export interface EntityFileProbe {
  exists(type: string, slug: string): boolean;
  read(type: string, slug: string): unknown;
}

/**
 * 0.2.7 — read the pre-update `createdAt` off the ENTITY FILE.
 *
 * A partial update carries no system fields, so the host assembles the object to
 * write from "the existing entity file + the delta". Every update path used to
 * take `createdAt` from the SQLite row it had just `SELECT`ed instead — and the
 * row is a PROJECTION of the file, so reading it reverses the direction of flow:
 * once the two disagree, `EntityStore.persist` regenerates the file from the row
 * and writes the divergence into the source. The file is the only admissible
 * source here.
 *
 * Returns `null` when there is no file behind the write, or its envelope is
 * missing/unparseable — the caller falls back to the row, which is still a better
 * answer than minting a fresh `createdAt`. Pass the INCOMING slug: on a rename
 * the file is still at the old one when this runs.
 *
 * The round-trip fixpoint test never let file and row disagree, which is exactly
 * why this was invisible for three releases.
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
    // A file that is unreadable or not JSON is not a reason to fail the mutation:
    // the row fallback keeps the write path working, and the next rebuild reports
    // the unreadable file through its own warning.
    return null;
  }
}

/**
 * `resolveStamp` for the UPDATE path: the file is consulted first, the row is the
 * fallback.
 *
 * This exists so the file read is SKIPPED when `opts.stamp` is present, which is
 * the whole reindex path — `indexAll()` supplies a stamp for every entity, and
 * passing `existingStampFromFile(...)` as an argument would read and parse each
 * file a second time, inside the one rebuild transaction, to produce a value
 * `resolveStamp` discards on its first line.
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
 * Decide the stamp for one mutation.
 *
 *   - `opts.stamp` present  ⇒ verbatim. This is the reindex/restore path: the
 *     value came out of the file and must land in the column unchanged, which is
 *     the whole invariant `row.created_at === file.createdAt` rests on.
 *   - `existing` present    ⇒ update: `createdAt` is preserved, `updatedAt` is now.
 *   - neither               ⇒ create: both are now.
 *
 * `type` is used only for the warning below.
 */
export function resolveStamp(
  type: string,
  opts?: MutateOpts,
  existing?: StampedRow | null,
): SystemStamp {
  if (opts?.stamp) return opts.stamp;

  /**
   * There is deliberately NO warning here on `writeFile: false`.
   *
   * The first draft warned when a mutation had no stamp and did not own the
   * file write, on the theory that it was minting a value no file could justify.
   * The predicate cannot carry that meaning: `HostEntityWriter` sets
   * `writeFile: false` on EVERY path it drives, so the flag does not separate
   * the reindex (which supplies a stamp) from `VersionService.restore` (which
   * deliberately does not, because a version restore is a mutation and must
   * mint a fresh `updatedAt`). It fired on the correct path, sending an operator
   * to debug a non-bug — and because it warned once per type and then went
   * quiet, it also spent the only warning that type would ever get, muting the
   * real signal it existed to carry.
   *
   * The invariant is enforced where it can actually be observed instead: the
   * round-trip fixpoint test asserts `file → index → file` is byte-identical,
   * which fails loudly if any write path mints a timestamp the file cannot
   * justify.
   */
  const now = nowIso();
  if (!existing) return { createdAt: now, updatedAt: now };
  return { createdAt: toIsoMs(existing.created_at) ?? now, updatedAt: now };
}

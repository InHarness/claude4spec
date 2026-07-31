/**
 * 0.2.4 — the backstop that keeps `row.created_at === file.createdAt` true for
 * types whose SQL we do not own.
 *
 * The six in-repo services write the stamp themselves, from `opts.stamp`. But a
 * type contributed by an externally-installed plugin — `database-table` today,
 * anything tomorrow — has its own `INSERT`/`UPDATE`, written before 0.2.4
 * existed, that still lets the column `DEFAULT (datetime('now'))` fire. Without
 * a backstop that type's row and its file disagree the moment it is reindexed,
 * and since the file is written FROM the row on the next `persist`, the
 * disagreement propagates into the file and the round trip stops converging.
 *
 * So after a restore the host compares and, only on mismatch, writes the file's
 * value into the columns. For the six services this is always a no-op — which is
 * the point: it costs one SELECT and it makes the invariant hold for everyone,
 * rather than for everyone who remembered.
 */

import type Database from 'better-sqlite3';
import { compositionOf } from '../../shared/plugin-host/composition.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { toIsoMs, type SystemStamp } from '../serialization/system-fields.js';

/**
 * A table name safe to interpolate into DDL/DML, or `null`.
 *
 * Table names reach us from a plugin MANIFEST and are interpolated into
 * `db.exec` — which happily runs multiple statements, so a `table` containing
 * `;` would execute arbitrary SQL that the deleted `ENTITY_TABLE` constant map
 * made structurally impossible. Restore that guarantee with a shape check
 * rather than a name allowlist (an allowlist is exactly the
 * host-knows-every-type coupling 0.2.2 removed).
 *
 * 0.2.4 promoted this to a REGISTRATION-time check
 * (`composition-validation.ts`), so by the time a module reaches here it should
 * already be unreachable. It stays as the assert that says so, and it lives
 * here rather than in the indexer because two callers now need it.
 */
export function safeTable(table: string | undefined, type: string): string | null {
  if (!table) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    console.warn(
      `[system-stamp] type '${type}' declares an unusable table name ` +
        `${JSON.stringify(table)} — expected a bare SQL identifier; skipping it`,
    );
    return null;
  }
  return table;
}

/** Types already warned about, so a full rebuild logs once per type, not once per entity. */
const warned = new Set<string>();

export interface ProjectStampOpts {
  /**
   * True when a service mutation just ran and was handed `opts.stamp`, so a
   * surviving mismatch really is the service ignoring it. False (default) on
   * paths where the host is the only writer and a write proves nothing.
   */
  expectServiceWrote?: boolean;
}

/**
 * Write `stamp` into the type's audit columns if they disagree with it.
 *
 * Silent and non-throwing on every structural miss (unknown type, unusable
 * table name, a table with no audit columns, a row that vanished): this is a
 * consistency backstop running inside an already-successful restore, and it
 * must never be the thing that fails a rebuild.
 *
 * Returns true when it actually wrote — i.e. when the type's own SQL had not
 * honoured `opts.stamp`.
 */
export function projectStamp(
  db: Database.Database,
  host: ProjectPluginHost,
  type: string,
  slug: string,
  stamp: SystemStamp,
  opts: ProjectStampOpts = {},
): boolean {
  const module = host.getAvailable(type);
  if (!module) return false;
  const resolved = compositionOf(module);
  const table = safeTable(resolved.mainTable, type);
  if (!table) return false;

  const identity = safeTable(resolved.identityColumn, type);
  if (!identity) return false;

  try {
    const row = db
      .prepare(`SELECT created_at, updated_at FROM ${table} WHERE ${identity} = ?`)
      .get(slug) as { created_at?: unknown; updated_at?: unknown } | undefined;
    if (!row) return false;
    /**
     * RAW text comparison, deliberately — not `toIsoMs(...) === stamp....`.
     *
     * Both forms denote the same instant, so a normalized comparison calls
     * `2026-07-31 14:00:00` and `2026-07-31T14:00:00.000Z` equal and returns
     * early, leaving the legacy `datetime('now')` text in the column forever.
     * That matters because `ORDER BY created_at` is a BYTE-WISE TEXT sort in
     * SQLite: `' '` (0x20) sorts before `'T'` (0x54), so a table holding both
     * forms orders every space-separated row ahead of every ISO one regardless
     * of the instants involved. One format per column is not cosmetic — it is
     * what makes the unified order mean anything.
     */
    if (row.created_at === stamp.createdAt && row.updated_at === stamp.updatedAt) {
      return false;
    }
    db.prepare(`UPDATE ${table} SET created_at = ?, updated_at = ? WHERE ${identity} = ?`).run(
      stamp.createdAt,
      stamp.updatedAt,
      slug,
    );
    /**
     * The warning accuses the type's SERVICE of ignoring `opts.stamp`, so it may
     * only fire on a path where a service actually ran. The release restore's
     * `noop` branch calls this as the SOLE writer — no mutation happened at all
     * — where a write is expected rather than evidence of a bug. Warning there
     * would libel a compliant type AND burn its one warning slot, permanently
     * suppressing the real signal this exists to carry.
     *
     * Only a genuine value CHANGE is reportable, too: rewriting `datetime('now')`
     * text into the same instant's ISO form is normalization, not a broken type.
     */
    const changed = toIsoMs(row.created_at) !== stamp.createdAt || toIsoMs(row.updated_at) !== stamp.updatedAt;
    if (opts.expectServiceWrote && changed && !warned.has(type)) {
      warned.add(type);
      console.warn(
        `[system-stamp] entity type '${type}' did not honour the supplied stamp — the host ` +
          `projected the file's timestamps into "${table}". The type's service should write ` +
          `opts.stamp into its created_at/updated_at columns itself.`,
      );
    }
    return true;
  } catch {
    // No audit columns on this table, or the table is gone mid-rebuild. Neither
    // is this function's problem to report.
    return false;
  }
}

/** Test seam: forget which types have warned. */
export function resetProjectionWarnings(): void {
  warned.clear();
}

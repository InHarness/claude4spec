import type { SnapshotData } from '@c4s/plugin-runtime';

/**
 * payload v1 → v2: DENSE `cells: string[][]` becomes the SPARSE keyed shape.
 *
 * WHY THIS EXISTS AT ALL. The v1 plugin's snapshot projection emitted the grid
 * densely — `nRows × nCols` rows of strings, empty cells as `""` — because it
 * owned both ends and could densify on the way out. The host's keyed-collection
 * snapshot does the opposite and is not negotiable: `normalizeKeyed` emits
 * `[{r, c, value}, …]`, sorted by key tuple, with empties dropped, because the
 * key IS the address and an unwritten cell is an absent row rather than a stored
 * blank.
 *
 * Without this step the two shapes meet at restore, where each element of the
 * dense outer array is read as one item: every key tuple comes out `null`,
 * nothing lands, and a sheet that still has all its content on disk reads back
 * as an empty grid. That failure is silent, which is why the migration is a
 * declared upgrade rather than leniency inside the reader.
 *
 * THE MARKER MAKES THIS EXACTLY RIGHT, not approximately. The host treats an
 * absent `payloadVersion` as 1, and every v1 file was written without one — so
 * "no marker" and "written dense" are the same corpus, with no heuristic in
 * between. Each file is rewritten once; the upgrade is a pure transform run
 * before the write path, so it stamps no `updatedAt` and captures no
 * `entity_version` row. A version bump therefore does not rewrite the audit
 * history of every sheet.
 */
export function denseCellsToSparse(payload: SnapshotData): SnapshotData {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const data = payload as Record<string, unknown>;

  const raw = data.cells;

  /*
   * A payload with no `cells` key at all is a real thing on disk, not a
   * hypothetical: at least one seed sheet was written before the key existed.
   * It upgrades to an empty grid rather than being refused — there is nothing
   * ambiguous about "no cells were recorded", and refusing would strand the
   * sheet's dimensions and name too.
   */
  if (raw === undefined || raw === null) return { ...data, cells: [] };
  if (!Array.isArray(raw)) return payload;

  /*
   * Idempotence, and the one case where doing nothing is the correct upgrade: a
   * sheet created after the port already carries the sparse shape. It should be
   * reachable only through a hand-edited marker, but "already migrated" must
   * never mean "migrate again" — the second pass would read `{r, c, value}` as
   * a dense row and produce nonsense.
   *
   * The decision is made over the WHOLE array, not over `raw[0]`. Judging by the
   * first element alone misreads a dense payload whose first row is `null` (or
   * anything else non-array) as already-sparse: it is then returned unmigrated,
   * the host stamps it `payloadVersion: 2`, and the miss is PERMANENT — the
   * upgrade never runs again, so no rebuild recovers a sheet whose content is
   * still sitting in the file. Dense is the safe reading when the two are mixed,
   * because `dense()` skips a malformed row while `sparse` would swallow one.
   */
  const looksSparse = raw.length > 0 && raw.every((row) => !Array.isArray(row));
  if (looksSparse) return payload;

  const dense = raw as unknown[][];
  const cells: Array<{ r: number; c: number; value: string }> = [];
  for (let i = 0; i < dense.length; i += 1) {
    const row = dense[i];
    if (!Array.isArray(row)) continue;
    for (let j = 0; j < row.length; j += 1) {
      const cell = row[j];
      const value = typeof cell === 'string' ? cell : cell == null ? '' : String(cell);
      // The sparse rule, applied at the boundary so the migrated file is
      // already what a rebuild would produce. `0` is content; `''` is not.
      if (value === '') continue;
      cells.push({ r: i + 1, c: j + 1, value });
    }
  }

  /*
   * The dimensions are the axis extents, so they must survive even when the
   * dense array is the only place they were ever visible. Backfilled ONLY when
   * absent or unusable: an authored `nRows` larger than the dense array is a
   * sheet with trailing empty rows, which is a fact about the sheet and not a
   * disagreement to correct.
   */
  const declaredRows = asCount(data.nRows);
  const declaredCols = asCount(data.nCols);
  const denseRows = dense.length;
  const denseCols = dense.reduce((max, row) => (Array.isArray(row) ? Math.max(max, row.length) : max), 0);

  return {
    ...data,
    nRows: declaredRows ?? denseRows,
    nCols: declaredCols ?? denseCols,
    cells,
  };
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * `payloadUpgrades[i]` takes payload `i+1` to `i+2`, and registration refuses a
 * chain whose length disagrees with the declared `payloadVersion` — so this
 * array and the `payloadVersion: 2` on the contribution move together or the
 * type does not register at all.
 */
export const spreadsheetPayloadUpgrades = [denseCellsToSparse];

import type { RawEntity, SparseCell } from '../../host-kit/host-types.js';

/** The shape + header labels of a sheet. Never body cells. */
export interface SpreadsheetOverview {
  slug: string;
  name: string;
  nRows: number;
  nCols: number;
  headerRow: boolean;
  headerCol: boolean;
  headerRowLabels?: string[];
  headerColLabels?: string[];
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const bool = (v: unknown): boolean => v !== 0 && v != null && v !== false;

/**
 * The metadata half, read straight off the row.
 *
 * The generic reader hands over COLUMN names and SQLite's integer booleans, so
 * `n_rows` and `0`/`1` are what actually arrive — not the `nRows` / `true` the
 * declaration is written in. Getting this wrong is how the v1 plugin once
 * persisted 29-byte `{"slug":"…","cells":[]}` stubs over real sheets.
 */
export function metaOf(entity: RawEntity): SpreadsheetOverview {
  return {
    slug: entity.slug,
    name: typeof entity.data.name === 'string' ? entity.data.name : '',
    nRows: num(entity.data.n_rows ?? entity.data.nRows),
    nCols: num(entity.data.n_cols ?? entity.data.nCols),
    headerRow: bool(entity.data.header_row ?? entity.data.headerRow),
    headerCol: bool(entity.data.header_col ?? entity.data.headerCol),
  };
}

/**
 * Add the perimeter header LABELS — row 1 when `headerRow`, column 1 when
 * `headerCol` — to a bare meta.
 *
 * The labels ride along with the overview on purpose, and it is the single most
 * load-bearing decision in this type's read discipline: a caller that knows the
 * shape almost always needs the names too, and if the overview withheld them
 * every reader would immediately follow up with a range read just to learn what
 * the columns are called. That follow-up would be a BODY read, which is exactly
 * what overview-first exists to avoid.
 *
 * The corner cell (1,1) legitimately appears in both lists when both flags are
 * set — it is the label of row 1 and of column 1 at once.
 */
export function buildOverview(meta: SpreadsheetOverview, cellAt: (r: number, c: number) => string): SpreadsheetOverview {
  const out: SpreadsheetOverview = { ...meta };
  if (meta.headerRow && meta.nCols > 0) {
    out.headerRowLabels = Array.from({ length: meta.nCols }, (_, i) => cellAt(1, i + 1));
  }
  if (meta.headerCol && meta.nRows > 0) {
    out.headerColLabels = Array.from({ length: meta.nRows }, (_, i) => cellAt(i + 1, 1));
  }
  return out;
}

/** Index a sparse cell list for O(1) lookup by coordinate. Absent ⇒ `''`. */
export function cellLookup(cells: readonly SparseCell[]): (r: number, c: number) => string {
  const byKey = new Map<string, string>();
  for (const cell of cells) byKey.set(`${cell.r}:${cell.c}`, cell.value);
  return (r, c) => byKey.get(`${r}:${c}`) ?? '';
}

/**
 * Coerce whatever `reader.readCollection` hands back into cells.
 *
 * It answers `[]` for an unknown type or an undeclared field rather than
 * throwing, so a bad shape here means a declaration mismatch, not a missing
 * sheet — dropping the malformed rows keeps a single bad row from taking out
 * the whole read.
 */
export function toSparseCells(items: readonly unknown[]): SparseCell[] {
  const out: SparseCell[] = [];
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const r = Number(row.r);
    const c = Number(row.c);
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 1 || c < 1) continue;
    out.push({ r, c, value: typeof row.value === 'string' ? row.value : '' });
  }
  return out;
}

/**
 * A dense rectangle out of sparse cells, 1-based inclusive, unwritten ⇒ `''`.
 *
 * Kept in ONE place and shared by every caller that needs a rectangle, which is
 * the same reason the v1 plugin kept its `densify` in one module: a second
 * implementation drifts, and the two shapes it produces (a serialized sheet and
 * a read window) are compared against each other by the tests.
 */
export function densify(
  cellAt: (r: number, c: number) => string,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): string[][] {
  const rows: string[][] = [];
  for (let r = r1; r <= r2; r += 1) {
    const row: string[] = [];
    for (let c = c1; c <= c2; c += 1) row.push(cellAt(r, c));
    rows.push(row);
  }
  return rows;
}

// 0.1.133: build the custom MCP server through the C4S facade barrel
// (`@c4s/plugin-runtime`), never the vendor `@inharness-ai/agent-adapters` directly.
import { createMcpServer, mcpTool, type McpServerFactory, type MountContext } from '@c4s/plugin-runtime';
import { z } from 'zod';
import type { KeyedCrudLike, RawEntity, ReaderLike } from '../../host-kit/host-types.js';
import { CELLS_FIELD, SPREADSHEET_TYPE } from '../../identity.js';
import { buildOverview, cellLookup, densify, metaOf, toSparseCells } from './overview.js';

/**
 * `spreadsheet-tools` — the read discipline and the write door, as tools.
 *
 * WHY A CUSTOM SERVER AT ALL, when the generic `entity-tools` already covers
 * create/rename/delete of a sheet: because the two things this type is actually
 * for are not derivable from a declaration. An overview that deliberately
 * withholds body cells, and a 1-based inclusive rectangle, are ergonomics — the
 * host has no way to know a grid wants them, and a generic read would hand back
 * the whole `cells` collection, which is the one outcome overview-first exists
 * to prevent.
 *
 * SHEET CRUD IS NOT HERE, on purpose. Creating, renaming, resizing or deleting a
 * sheet is a whole-entity mutation the generated `entity-tools` already does
 * from `data.schema`; duplicating it would give agents two doors to the same
 * write with one of them missing whatever the generic one gains next.
 *
 * WHY THE READS DO NOT USE THE DISCOVERY CORE. They were meant to: the core's
 * `collectionOverview` / `collectionWindow` are exactly these two reads, and the
 * HTTP routes the frontend uses are thin wrappers over them. But `MountContext`
 * carries no `discovery` — the core is constructed AFTER `mountBackend` in
 * `project-context.ts`, precisely because it needs things that do not exist yet
 * at mount time. So the published surface a plugin gets is `reader`, and the
 * windowing happens here instead. The output contract is unchanged (dense
 * rectangle, 1-based inclusive, unwritten ⇒ `""`); what differs is that a window
 * read costs a full collection read underneath. Filed as drift against the brief.
 */
export function createSpreadsheetMcpServer(ctx: MountContext): McpServerFactory {
  const reader = ctx.reader as ReaderLike;
  const crud = ctx.crud as KeyedCrudLike;

  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });
  const fail = (message: string) => ({
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  });
  const failErr = (err: unknown) => fail(err instanceof Error ? err.message : String(err));

  /** The row, or `null` when there is no such sheet. */
  const rowOf = (slug: string): RawEntity | null => {
    const entity = reader.getEntity(SPREADSHEET_TYPE, slug);
    return entity && typeof entity === 'object' ? (entity as RawEntity) : null;
  };
  const cellsOf = (slug: string) => toSparseCells(reader.readCollection(SPREADSHEET_TYPE, slug, CELLS_FIELD));
  const notFound = (slug: string) => fail(`spreadsheet not found: ${slug}`);

  const getOverview = mcpTool(
    'get_overview',
    'Get the cheap overview of a spreadsheet (dimensions + header flags + perimeter header labels from row 1 / column 1, NO body cell content). Start here — the labels come back with the overview, so you never need a separate range read just for header names; fetch only body cells by range afterwards.',
    { slug: z.string().describe('Spreadsheet slug (PK).') },
    (raw) => {
      const args = raw as Record<string, unknown>;
      const slug = String(args.slug);
      try {
        const row = rowOf(slug);
        if (!row) return notFound(slug);
        const meta = metaOf(row);
        if (!meta.headerRow && !meta.headerCol) return ok(meta);
        const perimeter = cellsOf(slug).filter((cell) => cell.r === 1 || cell.c === 1);
        return ok(buildOverview(meta, cellLookup(perimeter)));
      } catch (err) {
        return failErr(err);
      }
    },
  );

  const getRange = mcpTool(
    'get_range',
    'Read a rectangular window of cells. Indices are 1-based and inclusive. Empty cells come back as "". Fetch in windows; never pull the whole sheet at once.',
    {
      slug: z.string().describe('Spreadsheet slug (PK).'),
      r1: z.number().int().min(1).describe('First row (1-based, inclusive).'),
      c1: z.number().int().min(1).describe('First column (1-based, inclusive).'),
      r2: z.number().int().min(1).describe('Last row (1-based, inclusive).'),
      c2: z.number().int().min(1).describe('Last column (1-based, inclusive).'),
    },
    (raw) => {
      const args = raw as Record<string, unknown>;
      const slug = String(args.slug);
      const r1 = Number(args.r1);
      const c1 = Number(args.c1);
      const r2 = Number(args.r2);
      const c2 = Number(args.c2);
      if (!(r2 >= r1 && c2 >= c1)) return fail('r2 >= r1 and c2 >= c1 required');
      try {
        const row = rowOf(slug);
        if (!row) return notFound(slug);
        const cells = densify(cellLookup(cellsOf(slug)), r1, c1, r2, c2);
        return ok({ slug, r1, c1, r2, c2, cells });
      } catch (err) {
        return failErr(err);
      }
    },
  );

  const setCell = mcpTool(
    'set_cell',
    'Write a single cell (1-based r, c). Setting value to "" DELETES the cell from the sparse index. A coordinate past the sheet\'s current nRows/nCols is REFUSED — grow the sheet first with insert_row / insert_column.',
    {
      slug: z.string().describe('Spreadsheet slug (PK).'),
      r: z.number().int().min(1).describe('Row (1-based).'),
      c: z.number().int().min(1).describe('Column (1-based).'),
      value: z.string().describe('Cell content; "" clears/deletes the cell.'),
    },
    async (raw) => {
      const args = raw as Record<string, unknown>;
      const slug = String(args.slug);
      const r = Number(args.r);
      const c = Number(args.c);
      const value = String(args.value ?? '');
      try {
        if (!rowOf(slug)) return notFound(slug);
        /*
         * The window write, never `crud.update`. `update` reconciles a supplied
         * keyed collection REPLACE-ALL, so routing one cell through it would
         * delete every cell not resent — the exact failure the facade's keyed
         * door was added to remove.
         */
        await crud.writeCollectionWindow(SPREADSHEET_TYPE, slug, CELLS_FIELD, [{ r, c, value }], 'agent');
        return ok({ slug, r, c, value });
      } catch (err) {
        return failErr(err);
      }
    },
  );

  const setRange = mcpTool(
    'set_range',
    'Write a rectangular block of cells anchored at (r1, c1), row-major. Each "" clears/deletes that cell. Any coordinate past the sheet\'s current nRows/nCols is REFUSED and the WHOLE block is rolled back — grow the sheet first.',
    {
      slug: z.string().describe('Spreadsheet slug (PK).'),
      r1: z.number().int().min(1).describe('Anchor row (1-based).'),
      c1: z.number().int().min(1).describe('Anchor column (1-based).'),
      cells: z.array(z.array(z.string())).describe('Row-major block; cells[i][j] → (r1+i, c1+j).'),
    },
    async (raw) => {
      const args = raw as Record<string, unknown>;
      const slug = String(args.slug);
      const r1 = Number(args.r1);
      const c1 = Number(args.c1);
      const block = Array.isArray(args.cells) ? (args.cells as unknown[][]) : [];
      try {
        if (!rowOf(slug)) return notFound(slug);
        const entries: Array<{ r: number; c: number; value: string }> = [];
        for (let i = 0; i < block.length; i += 1) {
          const row = block[i];
          if (!Array.isArray(row)) continue;
          for (let j = 0; j < row.length; j += 1) {
            entries.push({ r: r1 + i, c: c1 + j, value: String(row[j] ?? '') });
          }
        }
        /*
         * One call, not one per cell: the whole block lands in ONE transaction
         * with ONE `entity_version` row, and a refused coordinate rolls back all
         * of it. Writing cell-by-cell would leave a half-applied block behind
         * and a version row per cell.
         */
        await crud.writeCollectionWindow(SPREADSHEET_TYPE, slug, CELLS_FIELD, entries, 'agent');
        return ok({ slug, r1, c1, rows: block.length, cells: entries.length });
      } catch (err) {
        return failErr(err);
      }
    },
  );

  /**
   * The four axis tools. New in this port — v1 had `insertRow`/`deleteRow`/
   * `insertColumn`/`deleteColumn` in its service but never exposed them as
   * tools, so an agent could only resize a sheet by rewriting it.
   *
   * KEYS ARE NOT STABLE ACROSS THESE CALLS. Everything past the position shifts,
   * so a caller holding coordinates from before the call is holding stale
   * addresses — which is why the extent AFTER the operation is returned rather
   * than left to be computed.
   */
  const axisTool = (name: string, description: string, axisKey: 'r' | 'c', op: 'insert' | 'delete') =>
    mcpTool(
      name,
      description,
      {
        slug: z.string().describe('Spreadsheet slug (PK).'),
        at: z.number().int().min(1).describe('Position (1-based).'),
      },
      async (raw) => {
        const args = raw as Record<string, unknown>;
        const slug = String(args.slug);
        const at = Number(args.at);
        try {
          if (!rowOf(slug)) return notFound(slug);
          const result = await crud.mutateCollectionAxis(SPREADSHEET_TYPE, slug, CELLS_FIELD, axisKey, op, at, 'agent');
          return ok({ slug, at, extent: result.extent });
        } catch (err) {
          return failErr(err);
        }
      },
    );

  return createMcpServer({
    name: 'spreadsheet-tools',
    tools: [
      getOverview,
      getRange,
      setCell,
      setRange,
      axisTool(
        'insert_row',
        'Insert an empty row at `at` (1-based), shifting every row at or past it down by one and incrementing nRows. Cell coordinates are NOT stable across this call. Returns the new nRows.',
        'r',
        'insert',
      ),
      axisTool(
        'delete_row',
        'Delete the row at `at` (1-based) with its cells, shifting every row past it up by one and decrementing nRows. Cell coordinates are NOT stable across this call. Returns the new nRows.',
        'r',
        'delete',
      ),
      axisTool(
        'insert_column',
        'Insert an empty column at `at` (1-based), shifting every column at or past it right by one and incrementing nCols. Cell coordinates are NOT stable across this call. Returns the new nCols.',
        'c',
        'insert',
      ),
      axisTool(
        'delete_column',
        'Delete the column at `at` (1-based) with its cells, shifting every column past it left by one and decrementing nCols. Cell coordinates are NOT stable across this call. Returns the new nCols.',
        'c',
        'delete',
      ),
    ],
  });
}

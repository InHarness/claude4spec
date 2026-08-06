import type { DataDeclaration, SlugPattern } from '@c4s/plugin-runtime';
import { SPREADSHEET_CELL_TABLE } from '../../identity.js';

/**
 * Host API 2.0.0 — what `spreadsheet` IS, and the whole of the port.
 *
 * The v1 plugin spent 582 lines of `services.ts`, two SQL migrations, a CRUD
 * adapter, a zod schema module and four Express routes saying what this literal
 * says. None of that comes across, because the host derives every one of them
 * from this declaration: the projection tables (`projection.ts`), the sparse
 * discipline that makes an empty cell a DELETE (`projection-write.ts`), the
 * windowed read (`discovery/ops/collections.ts`), snapshot/restore
 * (`serialization/schema-snapshot.ts`), the zod create/update shapes
 * (`crud-schema-gen.ts`) and the `/api/spreadsheets` router.
 *
 * `cells` is the repo's FIRST `collection: 'keyed'` — until this envelope the
 * M39 tier-C machinery had only fixtures for consumers.
 *
 * WHY THE DIMENSIONS ARE FIELDS AND NOT A COUNT. `nRows`/`nCols` are the axes'
 * declared extents, and the overview reports the grid FROM them, never from
 * `MAX(coordinate)`. That is what makes trailing empty rows a real part of the
 * sheet rather than an artefact — a 10×3 grid with one cell written in row 2 is
 * still 10×3, and clearing that cell does not shrink it. It is also why a write
 * past the extent is refused rather than growing the sheet: the extent is
 * authored, not inferred.
 */
export const spreadsheetData: DataDeclaration = {
  schema: {
    name: { kind: 'string', required: true, description: 'Human title of the sheet.' },
    nRows: {
      kind: 'number',
      column: 'n_rows',
      default: 0,
      description: 'Row count. The `r` axis extent — authored, not derived from written cells.',
    },
    nCols: {
      kind: 'number',
      column: 'n_cols',
      default: 0,
      description: 'Column count. The `c` axis extent — authored, not derived from written cells.',
    },
    headerRow: {
      kind: 'boolean',
      column: 'header_row',
      default: false,
      description: 'Row 1 holds column labels.',
    },
    headerCol: {
      kind: 'boolean',
      column: 'header_col',
      default: false,
      description: 'Column 1 holds row labels.',
    },
    /**
     * The grid. `projectionTable` is pinned to v1's `spreadsheet_cell` rather
     * than taking the host's `spreadsheet_cells` default — the index is derived
     * and rebuildable either way, but keeping the name means an existing
     * database needs no rename, and every v1-era query in a note or a script
     * still reads true.
     *
     * `value` is the only field outside the key, which is what a keyed
     * collection requires: the key is the ADDRESS, so a collection whose every
     * field is part of the key would carry no content to address.
     */
    cells: {
      kind: 'collection',
      collection: 'keyed',
      keyFields: ['r', 'c'],
      axes: [
        { key: 'r', extent: 'nRows' },
        { key: 'c', extent: 'nCols' },
      ],
      projectionTable: SPREADSHEET_CELL_TABLE,
      description:
        'Sparse cell index, 1-based. An empty value is not stored; writing an empty value deletes the key. Read by windows, never whole.',
      item: {
        kind: 'object',
        fields: {
          r: { kind: 'number', required: true, description: 'Row, 1-based.' },
          c: { kind: 'number', required: true, description: 'Column, 1-based.' },
          value: { kind: 'string', description: 'Cell content. Inline markdown.' },
        },
      },
    },
    createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
};

/**
 * `slugify(name)` — v1's `spreadsheetSlugFrom` minus its two fallbacks.
 *
 * v1 fell back to a random suffix when `name` slugified to nothing, and
 * separately deduped `-2` / `-3` inside its own create transaction. The host
 * covers the second with `slugConflict: 'suffix'` on the contribution; the first
 * is covered by `name` being `required`, which the generated create schema
 * enforces as non-blank precisely because this pattern has a single alternative.
 */
export const spreadsheetSlugPattern: SlugPattern = [{ op: 'slugify', field: 'name' }];

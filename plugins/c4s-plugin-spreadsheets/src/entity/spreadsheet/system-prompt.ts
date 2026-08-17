import type { SystemPromptContribution } from '@c4s/plugin-runtime';

/**
 * Ported from the v1 plugin essentially verbatim — the reading discipline is
 * the type's whole reason for existing, so the wording that teaches it is not
 * something to paraphrase on the way across.
 *
 * The one substantive addition is the growth rule in `mcpToolsLine`: under Host
 * API 2.x a write past the declared extent is refused rather than growing the
 * sheet, and an agent that does not know that will read the refusal as a bug.
 */
export const spreadsheetSystemPrompt: SystemPromptContribution = {
  roleNoun: 'spreadsheets',
  mcpToolsLine:
    'Tools under `spreadsheet-tools`: get_overview (dimensions + header flags + perimeter header ' +
    'labels, no body cells), get_range (a 1-based inclusive window of cells), set_cell and set_range ' +
    '(point writes; value "" deletes a cell), and insert_row / delete_row / insert_column / ' +
    'delete_column (shift the grid and update the dimension). Create/rename a sheet with the generic ' +
    'entity tools. A write past the current nRows/nCols is REFUSED — grow the sheet first with an ' +
    'insert, or set the dimension through the generic update tool.',
  narrativeBlock:
    'Spreadsheets are read OVERVIEW-FIRST — a reading discipline that pays off at ANY size, ' +
    'not only for large sheets. Never pull the whole grid when you only need its shape.\n' +
    '1. ALWAYS start from the overview — dimensions (nRows × nCols), the header_row / header_col ' +
    'flags, and the perimeter header labels (names from row 1 and column 1) — before touching any ' +
    'body content. `get_overview` returns exactly this skeleton, never body cells, and it is the ' +
    'ONLY source of the perimeter labels: the read record at its default width carries the ' +
    'dimensions and the two flags as ordinary fields, but no labels and no cells.\n' +
    '2. Because `get_overview` already carries the header names, you do NOT need a separate range read ' +
    'just for labels. Fetch only BODY cell content by RANGES via `spreadsheet-tools` (get_range), in ' +
    'windows sized to what you actually need — never the entire sheet at once. Indices are 1-based ' +
    'and inclusive.\n' +
    '3. Do NOT equate the overview with body content: it is the shape plus header labels. Body ' +
    'cells are always a separate, explicit range read.\n' +
    '4. The dimensions are AUTHORED, not inferred from where cells happen to be. Clearing the last ' +
    'written cell does not shrink the sheet, and a sheet may legitimately have trailing empty rows.',
};

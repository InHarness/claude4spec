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
  /**
   * 0.2.50 — cut from ~1 370 characters to the slot's stated budget ("2-3
   * sentences max, operational knowledge only").
   *
   * What went was structural rather than stylistic: points 3 and 4 of the old
   * four-point list restated and justified point 1 — "do NOT equate the overview
   * with body content" says again what "returns exactly this skeleton, never
   * body cells" already said — and the paragraph explaining that dimensions are
   * authored rather than inferred is a fact about storage, which the budget
   * excludes and which the write tools' own refusal teaches at the moment it
   * matters.
   *
   * What stays is the DECISION the agent actually faces on this type, and the
   * reason it exists: which of two read tools to reach for, and why the cheap
   * one is nearly always right.
   */
  narrativeBlock:
    'Spreadsheets are read OVERVIEW-FIRST, at any size: `get_overview` returns the shape ' +
    '(nRows × nCols, the header flags) plus the perimeter header labels from row 1 and column 1, ' +
    'and never a body cell — so it answers "what is in this sheet" without pulling the grid. ' +
    'It is also the ONLY source of those labels; the plain entity read carries the dimensions and ' +
    'flags but neither labels nor cells. Fetch body content with `get_range` afterwards, in windows ' +
    'sized to what you need (1-based, inclusive), never the whole sheet at once.',
};

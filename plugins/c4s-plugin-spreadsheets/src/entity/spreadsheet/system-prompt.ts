import type { SystemPromptContribution } from '@c4s/plugin-runtime';

/**
 * Ported from the v1 plugin essentially verbatim — the reading discipline is
 * the type's whole reason for existing, so the wording that teaches it is not
 * something to paraphrase on the way across.
 */
export const spreadsheetSystemPrompt: SystemPromptContribution = {
  roleNoun: 'spreadsheets',
  /**
   * 0.2.50 — reduced to the canonical `server: tool, tool` form, and this was a
   * correction rather than a trim. Since #171 this slot no longer feeds
   * `<tooling>`; what still reads it is `entityReadMcpTools`
   * (`chat-context.ts`), which splits it on `:` and `,` to build the
   * `spec-explore` subagent's tool allow-list. This was the repo's only line
   * written as prose, so that parse produced the server name "Tools under
   * `spreadsheet-tools`" and two tool names that carried their own
   * parentheticals — four impossible entries in an allow-list.
   *
   * The growth rule that used to close this line was the one RULE in a slot
   * that is now a manifest. It moved to `narrativeBlock` below, which is still
   * rendered into the prompt.
   */
  mcpToolsLine:
    'spreadsheet-tools: get_overview, get_range, set_cell, set_range, insert_row, delete_row, ' +
    'insert_column, delete_column',
  /**
   * 0.2.50 — cut from ~1 370 characters to the slot's stated budget, then given
   * back the two rules that have nowhere else to live.
   *
   * What went was structural rather than stylistic: points 3 and 4 of the old
   * four-point list restated and justified point 1, and the description of what
   * `get_overview` RETURNS duplicates the tool's own description, which the
   * agent has in `<tooling>` at the moment it calls it. What stays is the
   * DECISION the agent faces on this type — which of two read tools to reach
   * for, and why the cheap one is nearly always right — plus the refusal it
   * would otherwise read as a bug.
   */
  narrativeBlock:
    'Spreadsheets are read OVERVIEW-FIRST, at any size: `get_overview` answers "what is in this ' +
    'sheet" without pulling the grid, and it is the ONLY source of the perimeter header labels — ' +
    'the plain entity read carries neither those nor cells. Fetch body content with `get_range` ' +
    'afterwards, in windows sized to what you need, never the whole sheet at once. A write past ' +
    'the current nRows/nCols is REFUSED rather than growing the sheet: grow it first with an ' +
    'insert, or set the dimension through the generic update tool.',
};

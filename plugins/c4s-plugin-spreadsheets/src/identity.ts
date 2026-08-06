/**
 * Identity of the type this package contributes.
 *
 * Everything here is a plain constant, and the module is deliberately REACT-FREE:
 * `capabilities/commands.ts` names the popover kind and is reachable from
 * `src/index.ts`, the entry the host's Node loader imports. Reading two string
 * literals out of a `.tsx` would put React, `react/jsx-runtime` and
 * `lucide-react` on the server's plugin-load path — evaluated on every boot, and
 * a hard `PLUGIN_IMPORT_FAILED` (with the type silently absent) in any install
 * that prunes UI dependencies from a server image. The `api-contracts` envelope
 * learned this the same way.
 */

export const SPREADSHEET_TYPE = 'spreadsheet';

/**
 * The parent projection table. Named explicitly because the CELL table's name is
 * pinned in `data.schema` as `spreadsheet_cell` — the v1 plugin's table name,
 * kept so an existing index does not have to be dropped and rebuilt under a new
 * name for no reason. The host's own default would have been `spreadsheet_cells`.
 */
export const SPREADSHEET_TABLE = 'spreadsheet';
export const SPREADSHEET_CELL_TABLE = 'spreadsheet_cell';

export const SPREADSHEET_PATH_PREFIX = '/spreadsheets';
export const SPREADSHEET_LABEL = 'Spreadsheet';
export const SPREADSHEET_LABEL_PLURAL = 'Spreadsheets';

/**
 * Last in the sidebar order among contributed types — except the type never
 * reaches the sidebar at all (the frontend module declares no `sidebarTab`), so
 * this only orders it in catalogues, release snapshots and diffs.
 */
export const SPREADSHEET_DISPLAY_ORDER = 100;

/** The keyed collection every read and write addresses. */
export const CELLS_FIELD = 'cells';

/** The popover kind `/spreadsheet` dispatches. See the module note above. */
export const SPREADSHEET_POPOVER_KIND = `${SPREADSHEET_TYPE}-create`;

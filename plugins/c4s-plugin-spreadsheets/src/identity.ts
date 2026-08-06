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
 * The parent projection table, and the cell table the host derives from the
 * `cells` field.
 *
 * THE CELL TABLE IS DELIBERATELY *NOT* v1's `spreadsheet_cell`, and that is the
 * one place this port refuses to reuse what came before. v1's table is
 * `(slug, r, c, value)` with `PRIMARY KEY (slug, r, c)`; a keyed collection
 * projects to `(<parent>_slug, r, c, value)` with `UNIQUE(<parent>_slug, r, c)`.
 * The two disagree on the binding COLUMN, so pinning the old name does not adopt
 * the old table — it collides with it, in the worst possible way:
 * `CREATE TABLE IF NOT EXISTS` no-ops, column reconciliation adds a nullable
 * `spreadsheet_slug` to the legacy table, every read filters on a column that is
 * NULL in every legacy row, and the first write dies on an `ON CONFLICT` clause
 * matching no constraint — inside the rebuild's transaction, so the whole
 * reindex rolls back and the project is served from a permanently stale index.
 *
 * Taking the host's default name sidesteps all of it: `spreadsheet_cells` cannot
 * exist in a v1 database, so it is created fresh and filled from the entity
 * files, which are the source of truth. v1's `spreadsheet_cell` is left where it
 * is — untouched and unread. It is derived data with a file behind it, so
 * nothing is lost by orphaning it, and dropping a table full of a user's rows on
 * their first boot after an upgrade is not a decision this envelope should make
 * silently.
 */
export const SPREADSHEET_TABLE = 'spreadsheet';
export const SPREADSHEET_CELL_TABLE = 'spreadsheet_cells';

/** v1's cell table. Named only so tests can assert it is NOT what we bind to. */
export const LEGACY_SPREADSHEET_CELL_TABLE = 'spreadsheet_cell';

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

/**
 * The most cells any single read may materialise.
 *
 * Mirrors the discovery core's `MAX_WINDOW_CELLS`, and is stated here because
 * this envelope reads through `ctx.reader` rather than through the core (the
 * core is built after `mountBackend`, so `MountContext` cannot carry it). The
 * cap came with the core; bypassing the core dropped it, which turned
 * `get_range` into an unbounded in-process allocation and left the embed asking
 * for windows the HTTP route refuses.
 *
 * Kept equal to the core's value on purpose: the MCP tool and the HTTP route are
 * two doors onto the same rectangle, and a caller should not discover that one
 * of them is stricter by hitting it.
 */
export const MAX_WINDOW_CELLS = 10_000;

/** The popover kind `/spreadsheet` dispatches. See the module note above. */
export const SPREADSHEET_POPOVER_KIND = `${SPREADSHEET_TYPE}-create`;

/**
 * Attribute order of the `<spreadsheet/>` embed tag.
 *
 * ONE definition, read by both the backend contribution
 * (`frontend.referenceType.attrOrder`, which is what the host's own serializer
 * and the reference registry use) and the client node's markdown serializer.
 * Two copies would drift, and the failure would be a page whose tag is rewritten
 * with its attributes reordered on every save.
 */
export const SPREADSHEET_ATTR_ORDER = ['slug', 'caption'] as const;

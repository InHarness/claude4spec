import type { EntityContribution, MountContext } from '@c4s/plugin-runtime';
import {
  SPREADSHEET_ATTR_ORDER,
  SPREADSHEET_DISPLAY_ORDER,
  SPREADSHEET_LABEL,
  SPREADSHEET_LABEL_PLURAL,
  SPREADSHEET_PATH_PREFIX,
  SPREADSHEET_TYPE,
} from '../../identity.js';
import { spreadsheetData, spreadsheetSlugPattern } from './schema.js';
import { spreadsheetSerializer } from './views.js';
import { spreadsheetSystemPrompt } from './system-prompt.js';
import { createSpreadsheetMcpServer } from './mcp.js';

/**
 * The `spreadsheet` contribution — the port of `c4s-plugin-spreadsheets 0.0.6`
 * onto Host API 2.x, and the repo's first consumer of a keyed collection.
 *
 * WHAT IS NOT HERE is the substance of the port. No `migrations`, no
 * `auxTables`, no `service`, no `crud`, no `routes`: the host derives the
 * projection tables from `data.schema`, the sparse write discipline from the
 * collection being keyed, the create/update zod shapes from the same
 * declaration, and `/api/spreadsheets` from `pathPrefix` + `data`. v1 wrote all
 * of that by hand — 582 lines of service, two SQL migrations, four read routes —
 * and none of it survives the move, because none of it was ever specific to
 * spreadsheets.
 *
 * `mcpServer` remains because tool ergonomics are not derivable: the host cannot
 * know that a grid wants an overview-first read discipline with 1-based
 * inclusive windows.
 *
 * THE TYPE IS HIDDEN, and there is no slot that says so. Hiddenness is the sum
 * of two omissions on the frontend module — no `sidebarTab`, no `routes` — which
 * leaves exactly three surfaces: the `<spreadsheet slug caption/>` embed, the
 * `/spreadsheet` slash command, and the MCP tools. `pathPrefix` is still
 * declared and still real: it is where the generated REST router lands, which is
 * what the slash-create popover posts to.
 */
export const spreadsheetEntity: EntityContribution = {
  type: SPREADSHEET_TYPE,
  data: spreadsheetData,
  slugPattern: spreadsheetSlugPattern,
  /**
   * v1 deduped colliding slugs with a `-2` / `-3` suffix inside its own create
   * transaction. Declaring the same intent keeps `Q1 report` twice from being a
   * hard failure — sheets are named by humans, and two sheets sharing a title is
   * ordinary rather than a mistake worth refusing.
   */
  slugConflict: 'suffix',
  /**
   * 2, not 1 — every sheet on disk predates this port and carries the dense
   * `cells: string[][]` v1 wrote. See `upgrades.ts`; registration refuses this
   * number without exactly one upgrade step behind it.
   */
  payloadVersion: 2,
  label: SPREADSHEET_LABEL,
  labelPlural: SPREADSHEET_LABEL_PLURAL,
  displayOrder: SPREADSHEET_DISPLAY_ORDER,
  pathPrefix: SPREADSHEET_PATH_PREFIX,
  serializer: spreadsheetSerializer,
  systemPrompt: spreadsheetSystemPrompt,
  backend: {
    mcpServer: (_service: unknown, ctx: MountContext) => createSpreadsheetMcpServer(ctx),
  },
  /*
   * 0.2.15 — the `frontend.referenceType` slot is gone from the host, and with
   * it `<spreadsheet slug caption/>`. A sheet is embedded like any other entity:
   * `<single_element type="spreadsheet" slug="…" caption="…"/>` for the grid,
   * `<inline_mention type="spreadsheet" slug="…"/>` for the chip. Broken-
   * reference detection comes from the generic `type=` path instead of a
   * per-tag `validate`, so it is not lost by the removal.
   */
} as EntityContribution;

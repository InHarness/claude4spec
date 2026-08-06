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
  frontend: {
    /**
     * M19 Slot B — `<spreadsheet slug caption/>` in a page. `entityType` is
     * injected from `module.type` by the registry, so the tag gets broken-
     * reference detection in `check_consistency` for free.
     */
    referenceType: {
      tag: SPREADSHEET_TYPE,
      attrOrder: [...SPREADSHEET_ATTR_ORDER],
      validate: (attrs: Record<string, string>) => {
        const ok = typeof attrs.slug === 'string' && attrs.slug.trim().length > 0;
        return { ok, category: ok ? 'ok' : 'missing-slug' };
      },
    },
  },
} as EntityContribution;

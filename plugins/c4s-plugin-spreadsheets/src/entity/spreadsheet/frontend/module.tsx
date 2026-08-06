import { useEffect, useState } from 'react';
import type { FrontendModule } from '@c4s/plugin-runtime';
import {
  SPREADSHEET_DISPLAY_ORDER,
  SPREADSHEET_LABEL,
  SPREADSHEET_LABEL_PLURAL,
  SPREADSHEET_PATH_PREFIX,
  SPREADSHEET_TYPE,
} from '../../../identity.js';
import { spreadsheetData, spreadsheetSlugPattern } from '../schema.js';
import { spreadsheetNodeExtension } from './node-view.js';
import { fetchShape, type SpreadsheetShape } from './hooks.js';

/**
 * The frontend module — and mostly a list of things it does NOT contribute.
 *
 * THIS IS WHAT "HIDDEN" MEANS. There is no `hidden` flag in the manifest types;
 * a type is hidden by omission, and the two omissions are here:
 *
 *   - no `sidebarTab`, so `Sidebar.tsx` filters it out of the rail entirely;
 *   - no `routes`, so there is no list page and no detail page to navigate to.
 *
 * What survives is the surface a spreadsheet is actually for: the
 * `<spreadsheet/>` embed inside a page, the `/spreadsheet` slash command, and
 * the MCP tools. Which is why the render slots below are stubs rather than
 * omissions — `validateFrontendModule` requires all four to be functions, and a
 * module failing validation has ALL its slots skipped, including the editor
 * extension that puts the grid on screen.
 */

const NullRender = () => null;

export const spreadsheetFrontendModule: FrontendModule = {
  type: SPREADSHEET_TYPE,
  data: spreadsheetData,
  slugPattern: spreadsheetSlugPattern,
  payloadVersion: 2,
  label: SPREADSHEET_LABEL,
  labelPlural: SPREADSHEET_LABEL_PLURAL,
  displayOrder: SPREADSHEET_DISPLAY_ORDER,
  pathPrefix: SPREADSHEET_PATH_PREFIX,

  // Required by the slot contract; unreachable in practice, because reaching a
  // chip/card/row/detail means a surface this type does not have.
  renderChip: NullRender,
  renderCard: NullRender,
  renderRow: NullRender,
  detailPanel: NullRender,

  /**
   * The shape of one sheet, for whatever generic host UI asks. Deliberately the
   * OVERVIEW and not the cells: a hook the host may call at any time must not be
   * a door through which a whole grid arrives.
   */
  useGetBySlug: (slug: string | null) => {
    const [data, setData] = useState<SpreadsheetShape | null | undefined>(undefined);
    useEffect(() => {
      if (!slug) {
        setData(null);
        return;
      }
      let alive = true;
      setData(undefined);
      fetchShape(slug)
        .then((s) => alive && setData(s))
        .catch(() => alive && setData(null));
      return () => {
        alive = false;
      };
    }, [slug]);
    return { data, isLoading: data === undefined };
  },

  /**
   * Empty on purpose. Tag-based listing feeds list pages and tag flyouts, and
   * this type has neither — answering with real rows would put a hidden type
   * into a surface it was deliberately kept out of.
   */
  listByTags: async () => [],

  /**
   * The node only. NO `slashCommand` here — the manifest's `contributes.commands`
   * owns `/spreadsheet`, and declaring it twice puts two entries in the palette
   * with the wrong one selected by default. See `capabilities/commands.ts`.
   */
  editorExtensions: [spreadsheetNodeExtension],
};

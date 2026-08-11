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
import { SpreadsheetCard, SpreadsheetChip, SpreadsheetFullscreen } from './node-view.js';
import { fetchShape, type SpreadsheetShape } from './hooks.js';

/**
 * The frontend module of a HIDDEN type.
 *
 * 0.2.16 — "hidden" is what the OMISSIONS mean, and the host reads them: no
 * `sidebarTab`, so the rail filters this type out; no `routes` and no
 * `detailPanel`, so there is no list or detail page and nowhere for a chip
 * click to navigate. (0.2.15 declared the same fact twice by pairing those
 * omissions with an `embedOnly: true` flag; the flag is gone, since two sources
 * for one fact can disagree and only one of them was load-bearing.)
 *
 * Two consequences the host enforces:
 *
 *   - `renderRow` / `detailPanel` are not required, so the `NullRender` stubs
 *     that once sat here are gone. They existed only to satisfy a slot check
 *     that demanded surfaces this type does not have, and a module failing that
 *     check had ALL its slots skipped;
 *   - `renderOverlay` IS required, because a hidden type's chip has nowhere to
 *     navigate and opens a fullscreen surface instead.
 *
 * The `<spreadsheet/>` tag is gone too: the grid is reached through
 * `<single_element type="spreadsheet" …/>`, dispatched generically on `type=`.
 */
export const spreadsheetFrontendModule: FrontendModule = {
  type: SPREADSHEET_TYPE,
  data: spreadsheetData,
  slugPattern: spreadsheetSlugPattern,
  payloadVersion: 2,
  label: SPREADSHEET_LABEL,
  labelPlural: SPREADSHEET_LABEL_PLURAL,
  displayOrder: SPREADSHEET_DISPLAY_ORDER,
  pathPrefix: SPREADSHEET_PATH_PREFIX,

  renderChip: SpreadsheetChip,
  renderCard: SpreadsheetCard,
  renderOverlay: SpreadsheetFullscreen,

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

  /*
   * 0.2.15 — no editor extensions at all. The node this used to contribute
   * (`spreadsheetNodeExtension`) went with the `<spreadsheet/>` tag; the generic
   * `single_element` node renders the grid now. `/spreadsheet` is unaffected —
   * the manifest's `contributes.commands` owns it, and always did.
   */
};

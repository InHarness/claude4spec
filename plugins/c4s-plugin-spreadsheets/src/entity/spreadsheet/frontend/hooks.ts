import { useEffect, useRef } from 'react';
import { PROJECT_ID, apiFetch } from '../../../frontend-kit/api-core.js';
import { CELLS_FIELD, SPREADSHEET_TYPE } from '../../../identity.js';

/**
 * The embed's read path.
 *
 * v1 shipped four Express routes of its own — `overview`, `range`, `rows`,
 * `columns` — and this module called them. All four are gone: the host serves
 * the same two reads generically from `data.schema`, for every type that
 * declares a keyed collection, on its cross-cutting entities router:
 *
 *   GET /api/projects/<id>/entities/spreadsheet/<slug>/collections/cells/overview
 *   GET /api/projects/<id>/entities/spreadsheet/<slug>/collections/cells/window?a1=&b1=&a2=&b2=
 *
 * They are NOT under the type's `pathPrefix`, which is worth saying out loud
 * because it looks like an oversight and is not: the routes belong to the
 * collection mechanism rather than to spreadsheets, so they sit where every
 * keyed type's do.
 *
 * The window is READ-ONLY by design. There is no write route to pair with these
 * and there should not be — a write is a domain mutation with a transaction, a
 * parent stamp and a version row behind it, and a REST verb that did all that
 * quietly would be a second write door with none of the guarantees.
 */

const COLLECTION_BASE = (slug: string) =>
  `/api/entities/${SPREADSHEET_TYPE}/${encodeURIComponent(slug)}/collections/${CELLS_FIELD}`;

/** One axis of a collection, as the overview reports it. */
export interface CollectionAxis {
  key: string;
  extent: string;
  length: number;
}

export interface CollectionOverview {
  axes: CollectionAxis[];
  itemFields: string[];
}

/** What the grid needs before it can ask for a single cell. */
export interface SpreadsheetShape {
  slug: string;
  name: string;
  nRows: number;
  nCols: number;
  headerRow: boolean;
  headerCol: boolean;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const bool = (v: unknown): boolean => v === true || v === 1;

/**
 * The shape of the sheet: dimensions from the collection overview, and the
 * name plus header flags from the entity itself.
 *
 * TWO CALLS, and the second is not redundant. `collectionOverview` answers about
 * the COLLECTION — its axes and their extents — and knows nothing about the
 * parent's other fields, so `headerRow` / `headerCol` / `name` are simply not in
 * it. They live on the entity row, which the generated REST router serves.
 *
 * The extents still come from the overview rather than from the entity's own
 * `nRows` / `nCols`, even though both report the same number: the overview is
 * the axis mechanism's own answer, so if the two ever disagree the grid should
 * follow the one the window read will actually be bounded by.
 */
export async function fetchShape(slug: string): Promise<SpreadsheetShape | null> {
  const [entityRes, overviewRes] = await Promise.all([
    apiFetch(`/api/spreadsheets/${encodeURIComponent(slug)}`),
    apiFetch(`${COLLECTION_BASE(slug)}/overview`),
  ]);
  if (!entityRes.ok || !overviewRes.ok) return null;

  const entityBody = (await entityRes.json()) as { data?: Record<string, unknown> } | Record<string, unknown>;
  const entity = ((entityBody as { data?: Record<string, unknown> }).data ?? entityBody) as Record<string, unknown>;
  const overview = (await overviewRes.json()) as CollectionOverview;

  const axisLength = (key: string): number | null => {
    const axis = overview.axes?.find((a) => a.key === key);
    return axis ? num(axis.length) : null;
  };

  return {
    slug,
    name: typeof entity.name === 'string' ? entity.name : slug,
    nRows: axisLength('r') ?? num(entity.nRows),
    nCols: axisLength('c') ?? num(entity.nCols),
    headerRow: bool(entity.headerRow),
    headerCol: bool(entity.headerCol),
  };
}

/**
 * A rectangle of cell values, 1-based inclusive.
 *
 * The response `items` is already DENSE row-major over the whole rectangle, so
 * v1's `densify()` is gone from the client entirely — an unwritten coordinate
 * comes back materialised rather than omitted, and `items[r - r1][c - c1]`
 * always addresses the cell the caller meant.
 *
 * What it does NOT come back as is a string. The window decodes payload fields
 * and drops the coordinates, so each element is `{ value: string | null }` —
 * `null` where nothing was written. Reading it as a string yields a grid of
 * `[object Object]`, which is exactly the sort of thing that renders fine in a
 * unit test asserting on lengths.
 */
export async function fetchWindow(
  slug: string,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): Promise<string[][] | null> {
  const query = `a1=${r1}&b1=${c1}&a2=${r2}&b2=${c2}`;
  const res = await apiFetch(`${COLLECTION_BASE(slug)}/window?${query}`);
  /*
   * `null` means "no window", and the CALLER must say so on screen. Returning
   * `[]` here would render an empty grid that looks exactly like a sheet with
   * no content — which is how a window the route refuses became a permanently
   * blank table with nothing explaining it.
   */
  if (!res.ok) return null;
  const body = (await res.json()) as { items?: unknown[][] };
  const items = Array.isArray(body.items) ? body.items : [];
  return items.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => {
      if (typeof cell === 'string') return cell;
      if (cell && typeof cell === 'object') {
        const value = (cell as Record<string, unknown>).value;
        return typeof value === 'string' ? value : '';
      }
      return '';
    }),
  );
}

/**
 * Re-read when the host says this entity changed.
 *
 * A raw `WebSocket` rather than a host hook because there is no published one —
 * the frame is part of the host's runtime behaviour, not of the plugin API. It
 * degrades to silence: if the socket cannot open, the embed simply does not
 * live-update, which is a strictly better outcome than the node view throwing
 * inside a Tiptap render.
 */
export function useEntityChanged(slug: string, onChange: () => void): void {
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    if (typeof WebSocket === 'undefined' || !slug || !PROJECT_ID) return;
    let socket: WebSocket | null = null;
    try {
      /*
       * `/ws?project=<id>`, NOT `${API_BASE}/ws`.
       *
       * The gateway is a per-project room on ONE path: it upgrades only when
       * `url.pathname === '/ws'` and refuses a missing `project` param outright.
       * Reusing `API_BASE` (which is `/api/projects/<id>`) produced
       * `/api/projects/<id>/ws`, which the upgrade handler simply ignores — so
       * the socket never opened, `entity:changed` never arrived, and the embed
       * silently stopped live-updating. Silently, because a socket that never
       * connects looks exactly like one where nothing has changed yet.
       */
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${proto}//${window.location.host}/ws?project=${encodeURIComponent(PROJECT_ID)}`);
    } catch {
      return;
    }
    const onMessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        if (msg.kind === 'entity:changed' && msg.entityType === SPREADSHEET_TYPE && msg.slug === slug) {
          handler.current();
        }
      } catch {
        // Not every frame is JSON, and a non-JSON frame is not an error here.
      }
    };
    socket.addEventListener('message', onMessage);
    return () => {
      socket?.removeEventListener('message', onMessage);
      socket?.close();
    };
  }, [slug]);
}

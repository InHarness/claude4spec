import { Node, mergeAttributes } from '@tiptap/core';
import { createElement, useEffect, useMemo, useState, type FC } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fetchShape, fetchWindow, useEntityChanged, type SpreadsheetShape } from './hooks.js';
import { renderInlineMarkdown } from './inline-markdown.js';
import { MAX_WINDOW_CELLS, SPREADSHEET_ATTR_ORDER, SPREADSHEET_TYPE } from '../../../identity.js';

/**
 * `<spreadsheet slug caption/>` — the type's primary surface, and one of only
 * three it has.
 *
 * READ-ONLY, and that is a design decision rather than an unfinished edge. The
 * window read is bounded and cheap precisely because it makes no promise about
 * what is outside it; an editable grid would need to hold a dirty set across
 * pages of a window whose coordinates are not stable under an axis insert. Cells
 * are written through the MCP tools, and the embed re-reads when the host says
 * the entity changed.
 */

/** Rows fetched at a time. A window, not a viewport — no measuring, no virtual scroller. */
const ROW_WINDOW = 50;

/**
 * Rows this grid may ask for, given how wide it is.
 *
 * The read route refuses any window over `MAX_WINDOW_CELLS`, so a fixed 50-row
 * window is only safe up to 200 columns — past that every request was refused
 * and the embed rendered a permanently blank table with no error, because a
 * failed read and an empty sheet looked identical on screen. Narrowing the
 * window keeps a wide sheet readable (fewer rows per page) instead of unreadable.
 */
function rowsPerWindow(nCols: number): number {
  if (nCols < 1) return ROW_WINDOW;
  return Math.max(1, Math.min(ROW_WINDOW, Math.floor(MAX_WINDOW_CELLS / nCols)));
}

const SpreadsheetGrid: FC<{ slug: string; caption?: string }> = ({ slug, caption }) => {
  // `undefined` = still loading, `null` = no such sheet. Two different renders,
  // so they cannot share one falsy state.
  const [shape, setShape] = useState<SpreadsheetShape | null | undefined>(undefined);
  const [start, setStart] = useState<number>(1);
  const [cells, setCells] = useState<string[][]>([]);
  const [reloadKey, setReloadKey] = useState<number>(0);
  // A refused or failed window is NOT an empty sheet, and must not render as one.
  const [windowError, setWindowError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchShape(slug)
      .then((s) => alive && setShape(s))
      .catch(() => alive && setShape(null));
    return () => {
      alive = false;
    };
  }, [slug, reloadKey]);

  const nRows = shape?.nRows ?? 0;
  const nCols = shape?.nCols ?? 0;

  const pageRows = useMemo(() => rowsPerWindow(nCols), [nCols]);

  const windowRange = useMemo(() => {
    const r1 = Math.max(1, Math.min(start, Math.max(1, nRows)));
    const r2 = Math.min(nRows, r1 + pageRows - 1);
    return { r1, r2 };
  }, [start, nRows, pageRows]);

  useEffect(() => {
    if (!shape || nRows < 1 || nCols < 1) {
      setCells([]);
      setWindowError(null);
      return;
    }
    let alive = true;
    fetchWindow(slug, windowRange.r1, 1, windowRange.r2, nCols)
      .then((rows) => {
        if (!alive) return;
        if (rows === null) {
          setCells([]);
          setWindowError('could not be read');
          return;
        }
        setCells(rows);
        setWindowError(null);
      })
      .catch(() => {
        if (!alive) return;
        setCells([]);
        setWindowError('could not be read');
      });
    return () => {
      alive = false;
    };
  }, [slug, shape, nRows, nCols, windowRange.r1, windowRange.r2, reloadKey]);

  useEntityChanged(slug, () => setReloadKey((k) => k + 1));

  if (shape === undefined) {
    return createElement('div', { className: 'c4s-spreadsheet c4s-spreadsheet--loading' }, 'Loading spreadsheet…');
  }
  if (shape === null) {
    return createElement(
      'div',
      { className: 'c4s-spreadsheet c4s-spreadsheet--broken', 'data-broken-ref': slug },
      `⚠ Spreadsheet "${slug}" is missing or inactive.`,
    );
  }

  const rowEls = cells.map((row, i) => {
    const absR = windowRange.r1 + i;
    const isHeaderRow = shape.headerRow && absR === 1;
    const cellEls = row.map((value, j) => {
      const absC = j + 1;
      const isHeaderCol = shape.headerCol && absC === 1;
      const isHeader = isHeaderRow || isHeaderCol;
      return createElement(
        isHeader ? 'th' : 'td',
        {
          key: `${absR}:${absC}`,
          scope: isHeaderRow ? 'col' : isHeaderCol ? 'row' : undefined,
          className: 'c4s-spreadsheet__cell',
        },
        ...renderInlineMarkdown(value, `${absR}:${absC}`),
      );
    });
    return createElement('tr', { key: absR, className: 'c4s-spreadsheet__row' }, cellEls);
  });

  /*
   * A plain `<table>` with no styling of its own, and no `not-prose` on the
   * wrapper. The editor already styles `.prose-spec table / th / td` — borders,
   * padding, a panel background on headers — and the node view mounts inside
   * that scope, so the grid inherits the same table look as every other table in
   * a page. Shipping a stylesheet here would mean maintaining a second, slightly
   * different table style forever. (The `.not-prose` reset only touches
   * `ul`/`ol`/`li`/`p`, so it would not have helped anyway — it would only have
   * flattened the caption.)
   */
  const table = createElement('table', { className: 'c4s-spreadsheet__table' }, createElement('tbody', null, rowEls));

  const windowedAbove = windowRange.r1 > 1;
  const windowedBelow = windowRange.r2 < nRows;

  // Shown INSTEAD of an empty grid: a read the server refused and a sheet with
  // nothing in it are the same picture otherwise.
  const errorBanner = windowError
    ? createElement(
        'div',
        {
          className: 'c4s-spreadsheet__error',
          style: { fontSize: 12, color: 'var(--c-red, #b3261e)', margin: '4px 0' },
        },
        `⚠ Rows ${windowRange.r1}–${windowRange.r2} ${windowError}.`,
      )
    : null;
  const pager =
    windowedAbove || windowedBelow
      ? createElement(
          'div',
          {
            className: 'c4s-spreadsheet__pager',
            style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12 },
          },
          createElement(
            'button',
            {
              type: 'button',
              disabled: !windowedAbove,
              onClick: () => setStart((s) => Math.max(1, s - pageRows)),
            },
            '↑ Prev rows',
          ),
          createElement(
            'span',
            { className: 'c4s-spreadsheet__range-label', style: { color: 'var(--c-subtle)' } },
            `rows ${windowRange.r1}–${windowRange.r2} of ${nRows}`,
          ),
          createElement(
            'button',
            {
              type: 'button',
              disabled: !windowedBelow,
              onClick: () => setStart((s) => Math.min(nRows, s + pageRows)),
            },
            '↓ Next rows',
          ),
        )
      : null;

  return createElement(
    'div',
    { className: 'c4s-spreadsheet', 'data-slug': slug },
    caption
      ? createElement(
          'div',
          {
            className: 'c4s-spreadsheet__caption',
            style: { fontSize: 12, color: 'var(--c-subtle)', marginBottom: 4 },
          },
          ...renderInlineMarkdown(caption, 'caption'),
        )
      : null,
    errorBanner,
    // A wide sheet scrolls inside its own box rather than widening the page.
    createElement('div', { className: 'c4s-spreadsheet__scroll', style: { overflowX: 'auto' } }, table),
    pager,
  );
};

/**
 * `<spreadsheet slug="…" caption="…"/>` — the self-closing form, attributes in
 * the order `frontend.referenceType.attrOrder` declares, empty ones omitted.
 *
 * Mirrors the host's `serializeXmlTag`; see the note on `addStorage` below.
 */
export function serializeSpreadsheetTag(attrs: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of SPREADSHEET_ATTR_ORDER) {
    const value = attrs[key];
    if (value == null || value === '') continue;
    parts.push(`${key}="${String(value).replace(/"/g, '&quot;')}"`);
  }
  return `<${SPREADSHEET_TYPE} ${parts.join(' ')}/>`;
}

export const spreadsheetNode = Node.create({
  name: SPREADSHEET_TYPE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { slug: { default: null }, caption: { default: null } };
  },
  parseHTML() {
    return [{ tag: SPREADSHEET_TYPE }];
  },
  renderHTML({ HTMLAttributes }) {
    return [SPREADSHEET_TYPE, mergeAttributes(HTMLAttributes)];
  },
  /**
   * How this node goes BACK to markdown.
   *
   * Without it tiptap-markdown has no serializer for the node and falls back to
   * its generic HTML writer, which emits the PAIRED form — `<spreadsheet …>` on
   * one line and a stray `</spreadsheet>` on the next. Every save of every page
   * carrying an embed would then rewrite the tag into a shape that is not the
   * `<spreadsheet slug caption/>` syntax the type documents, producing a
   * two-line diff in the spec repo that nobody authored.
   *
   * `serializeXmlTag` is mirrored rather than imported: it lives in the host's
   * `shared/xml-tags.ts` and is not exported through `@c4s/plugin-runtime`, the
   * same host gap `frontend-kit/slash-create.tsx` records for the embed node
   * name and the command event. The attribute ORDER here must stay in step with
   * the `attrOrder` declared in `entity/spreadsheet/index.ts`; a test pins it.
   */
  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void; closeBlock: (n: unknown) => void }, node: { attrs: Record<string, unknown> }) {
          state.write(serializeSpreadsheetTag(node.attrs));
          state.closeBlock(node);
        },
      },
    };
  },
  addNodeView() {
    return (props) => {
      const dom = document.createElement('div');
      dom.className = 'c4s-spreadsheet-nodeview';
      dom.setAttribute('data-type', SPREADSHEET_TYPE);
      const slug = String(props.node.attrs.slug ?? '');
      const caption = props.node.attrs.caption != null ? String(props.node.attrs.caption) : undefined;

      /*
       * `createRoot` by hand rather than `@tiptap/react`: this envelope's only
       * Tiptap dependency is `@tiptap/core`, and pulling the React bindings in
       * for one node view would add a second reconciler entry point beside the
       * host's.
       */
      let root: Root | null = null;
      if (slug) {
        root = createRoot(dom);
        root.render(createElement(SpreadsheetGrid, { slug, caption }));
      } else {
        dom.textContent = '⚠ <spreadsheet/> is missing a slug.';
      }

      return {
        dom,
        ignoreMutation: () => true,
        // Unmount on a later tick: React refuses to unmount a root from inside
        // a render/commit, and ProseMirror can destroy a node view during one.
        destroy: () => {
          const r = root;
          if (r) setTimeout(() => r.unmount(), 0);
        },
      };
    };
  },
});

export const spreadsheetNodeExtension = {
  name: `${SPREADSHEET_TYPE}-node`,
  extension: spreadsheetNode,
};

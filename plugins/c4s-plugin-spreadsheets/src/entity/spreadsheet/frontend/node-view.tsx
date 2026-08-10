import { createElement, useEffect, useMemo, useState, type FC } from 'react';
import { fetchShape, fetchWindow, useEntityChanged, type SpreadsheetShape } from './hooks.js';
import { renderInlineMarkdown } from './inline-markdown.js';
import { MAX_WINDOW_CELLS } from '../../../identity.js';

/**
 * The grid — the type's primary surface.
 *
 * 0.2.15: it used to hang off a `<spreadsheet slug caption/>` node the type
 * contributed. That tag is gone; the grid is now the entity's `renderCard`
 * slot, reached through `<single_element type="spreadsheet" …/>` and dispatched
 * generically on `type=`. Nothing about what it draws changed — only what
 * addresses it.
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

export const SpreadsheetGrid: FC<{ slug: string; caption?: string }> = ({ slug, caption }) => {
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
 * 0.2.15 — `renderCard`: what `<single_element type="spreadsheet" …/>` draws.
 *
 * The `entity` prop is the OVERVIEW (`useGetBySlug` → `fetchShape`), deliberately
 * not the cells; the grid fetches its own windows. The card only uses it to tell
 * a missing sheet from a loading one, which the grid would otherwise render
 * identically.
 */
export const SpreadsheetCard: FC<{
  slug: string;
  entity: unknown;
  caption?: string;
  onOpen?: () => void;
}> = ({ slug, entity, caption, onOpen }) => {
  if (entity === null) {
    return createElement(
      'div',
      { className: 'c4s-spreadsheet c4s-spreadsheet--broken', 'data-broken-ref': slug },
      `⚠ Spreadsheet "${slug}" is missing or inactive.`,
    );
  }
  return createElement(
    'div',
    { className: 'c4s-spreadsheet-card', style: { position: 'relative' } },
    onOpen
      ? createElement(
          'button',
          {
            type: 'button',
            title: 'Open fullscreen',
            'aria-label': `Expand spreadsheet ${slug}`,
            onClick: (e: React.MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              onOpen();
            },
            style: {
              position: 'absolute',
              top: 0,
              right: 0,
              zIndex: 2,
              fontSize: 11,
              padding: '2px 6px',
              cursor: 'pointer',
              background: 'var(--c-card)',
              border: '1px solid var(--c-hair)',
              borderRadius: 3,
              color: 'var(--c-muted)',
            },
          },
          '⤢',
        )
      : null,
    createElement(SpreadsheetGrid, { slug, caption }),
  );
};

/**
 * 0.2.15 — `renderChip`: the inline form. A real chip rather than the
 * `NullRender` stub the type used to ship, which existed only to satisfy a slot
 * check that no longer demands a row or a detail panel from a hidden type.
 *
 * Clicking it opens the fullscreen overlay — the host routes that, because a
 * hidden type has no detail route to navigate to.
 */
export const SpreadsheetChip: FC<{ slug: string; entity: unknown; onOpen?: () => void }> = ({
  slug,
  entity,
  onOpen,
}) => {
  if (entity === null) {
    return createElement(
      'span',
      {
        className: 'c4s-spreadsheet-chip c4s-spreadsheet-chip--broken',
        title: `broken reference: spreadsheet '${slug}'`,
        style: {
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          padding: '1px 6px',
          borderRadius: 3,
          background: 'var(--c-red-soft, rgba(196,90,59,0.14))',
          color: 'var(--c-red, #c45a3b)',
          border: '1px solid var(--c-red, #c45a3b)',
        },
      },
      `⚠ ${slug}`,
    );
  }
  const shape = entity as SpreadsheetShape | undefined;
  const dims = shape ? ` ${shape.nRows}×${shape.nCols}` : '';
  return createElement(
    'button',
    {
      type: 'button',
      onClick: onOpen,
      title: `spreadsheet: ${slug}`,
      className: 'c4s-spreadsheet-chip',
      style: {
        fontSize: 12,
        fontFamily: 'var(--font-mono)',
        padding: '1px 6px',
        borderRadius: 3,
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair)',
        color: 'var(--c-ink)',
        cursor: onOpen ? 'pointer' : 'default',
      },
    },
    `▦ ${slug}${dims}`,
  );
};

/**
 * 0.2.15 — `renderOverlay`: the read-only fullscreen surface a chip or card
 * opens, mounted by the host's `EntityOverlayHost`.
 *
 * The same grid, given the whole viewport and its own scroll box. Escape closes,
 * as does a click on the scrim — matching `DiagramFullscreen`, the host's other
 * hidden-entity overlay, so the two hidden types behave identically.
 */
export const SpreadsheetFullscreen: FC<{
  slug: string;
  caption?: string;
  onClose: () => void;
}> = ({ slug, caption, onClose }) => {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createElement(
    'div',
    {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': `Spreadsheet ${slug}`,
      className: 'c4s-spreadsheet-fullscreen',
      style: {
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        background: 'rgba(47, 42, 37, 0.55)',
        display: 'flex',
        flexDirection: 'column',
        padding: 24,
      },
      onClick: (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
      },
    },
    createElement(
      'div',
      {
        style: {
          flex: 1,
          overflow: 'auto',
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair-strong)',
          borderRadius: 4,
          padding: 16,
        },
      },
      createElement(
        'button',
        {
          type: 'button',
          onClick: onClose,
          title: 'Close (Esc)',
          style: { float: 'right', cursor: 'pointer', fontSize: 13, padding: '2px 8px' },
        },
        '✕',
      ),
      createElement(SpreadsheetGrid, { slug, caption }),
    ),
  );
};

// @vitest-environment happy-dom
/**
 * c4s-plugin-spreadsheets — the `spreadsheet-expand` window content (`s7ao66dy`):
 * a read-only grid preview, without editing, scrollable through the whole
 * sheet, whose body the window fetches in range windows; `Esc` closes.
 *
 * Rendered for real (happy-dom + createRoot): only the two reads (`fetchShape`,
 * `fetchWindow`) and the live-update socket are stood in for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const reads = vi.hoisted(() => ({
  nRows: 120,
  nCols: 2,
  windows: [] as Array<[number, number, number, number]>,
  refuse: false,
}));

vi.mock('../../src/entity/spreadsheet/frontend/hooks.js', () => ({
  fetchShape: async (slug: string) => ({
    slug,
    name: 'Sheet',
    nRows: reads.nRows,
    nCols: reads.nCols,
    headerRow: true,
    headerCol: false,
  }),
  fetchWindow: async (_slug: string, r1: number, c1: number, r2: number, c2: number) => {
    reads.windows.push([r1, c1, r2, c2]);
    if (reads.refuse) return null;
    const out: string[][] = [];
    for (let r = r1; r <= r2; r++) {
      const row: string[] = [];
      for (let c = c1; c <= c2; c++) row.push(`R${r}C${c}`);
      out.push(row);
    }
    return out;
  },
  useEntityChanged: () => undefined,
}));

import { spreadsheetFrontendModule } from '../../src/entity/spreadsheet/frontend/module.js';
import { SpreadsheetFullscreen } from '../../src/entity/spreadsheet/frontend/node-view.js';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function open(onClose = vi.fn()) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(SpreadsheetFullscreen, { slug: 'big', onClose }));
  });
  await flush();
  return onClose;
}

async function scrollToBottom() {
  const box = document.querySelector('[data-testid="spreadsheet-expand-scroll"]') as HTMLElement;
  expect(box).not.toBeNull();
  await act(async () => {
    box.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await flush();
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  reads.windows.length = 0;
  reads.refuse = false;
  reads.nRows = 120;
  reads.nCols = 2;
});

describe('[section:s7ao66dy] spreadsheet-expand — read-only, scrollable through the whole sheet, range-windowed', () => {
  it('[section:s7ao66dy] the window content is SpreadsheetFullscreen: a read-only grid preview with no edit affordance; Esc closes', async () => {
    expect(spreadsheetFrontendModule.renderOverlay).toBe(SpreadsheetFullscreen);
    const onClose = await open();

    const dialog = document.querySelector('[data-testid="spreadsheet-fullscreen"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.style.position).toBe('fixed');
    // The grid is shown…
    expect(dialog.textContent).toContain('R1C1');
    expect(dialog.querySelector('th')?.textContent).toBe('R1C1');
    // …and nothing in it takes input.
    expect(dialog.querySelectorAll('input, textarea, select, [contenteditable="true"]')).toHaveLength(0);
    const buttons = Array.from(dialog.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(buttons).toEqual(['Close']);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('[section:s7ao66dy] the grid body is fetched in range windows — one bounded window first, never the whole sheet', async () => {
    await open();
    // One window of 50 rows × all columns, not rows 1–120.
    expect(reads.windows).toEqual([[1, 1, 50, 2]]);
    const box = document.querySelector('[data-testid="spreadsheet-expand-scroll"]') as HTMLElement;
    expect(box.style.overflow).toBe('auto');
    expect(box.textContent).toContain('R50C2');
    expect(box.textContent).not.toContain('R51C1');
  });

  it('[section:s7ao66dy] scrolling reaches every row of the sheet: each scroll to the bottom appends the next window until the last row', async () => {
    await open();
    await scrollToBottom();
    expect(reads.windows).toEqual([
      [1, 1, 50, 2],
      [51, 1, 100, 2],
    ]);
    await scrollToBottom();
    expect(reads.windows.at(-1)).toEqual([101, 1, 120, 2]);
    const box = document.querySelector('[data-testid="spreadsheet-expand-scroll"]') as HTMLElement;
    // Rows from all three windows are in the one scroll box, in order.
    expect(box.querySelectorAll('tr')).toHaveLength(120);
    expect(box.textContent).toContain('R120C2');
    expect(document.body.textContent).toContain('rows 1–120 of 120');

    // The whole sheet is in — a further scroll reads nothing more.
    await scrollToBottom();
    expect(reads.windows).toHaveLength(3);
    // Every read stayed a bounded window.
    for (const [r1, , r2] of reads.windows) expect(r2 - r1 + 1).toBeLessThanOrEqual(50);
  });

  it('[section:s7ao66dy] a refused window is reported with its rows instead of rendering as an empty sheet', async () => {
    reads.refuse = true;
    await open();
    expect(document.body.textContent).toContain('Rows 1–50 could not be read.');
    await scrollToBottom();
    // It does not hammer the route after a refusal.
    expect(reads.windows).toHaveLength(1);
  });
});

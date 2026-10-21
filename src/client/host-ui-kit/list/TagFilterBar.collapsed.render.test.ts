// @vitest-environment happy-dom
/**
 * 2.1.44 — `TagFilterBar` `variant` / `entityType`: one line with a "+N" overflow
 * popover, and `counts`-based narrowing. Layout is mocked (no layout engine in
 * happy-dom): the row is ROW_WIDTH px wide and every chip CHIP_WIDTH px.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TagFilterBar, type TagFilterBarProps } from './TagFilterBar.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHIP_WIDTH = 50;
const GAP = 6;
let rowWidth = 10_000;
/** Row wide enough for exactly `k` chips plus the "+N" reserve (48). */
const fitting = (k: number) => k * CHIP_WIDTH + (k - 1) * GAP + 48 + 1;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  rowWidth = 10_000;
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-tag-row')) return rowWidth;
    if (this.hasAttribute('data-tag-measure-chip')) return CHIP_WIDTH;
    return 0;
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const mount = (el: ReactNode) => act(() => root.render(el));
const NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
const TAGS = NAMES.map((name) => ({ slug: name.toLowerCase(), name }));

function bar(over: Partial<TagFilterBarProps> = {}) {
  mount(
    createElement(TagFilterBar, {
      tags: TAGS,
      tagFilter: [],
      onTagToggle: () => {},
      tagMode: 'and',
      onToggleMode: () => {},
      onClear: () => {},
      ...over,
    }),
  );
}
const rowChips = () =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-tag-row] span.rounded-full[role="button"]')).map((c) => c.textContent);
const plus = () =>
  Array.from(host.querySelectorAll('button')).find((b) => /^\+\d+$/.test(b.textContent ?? ''));
const popChips = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-tag-popover-list] span.rounded-full[role="button"]'));
const strip = () => host.firstElementChild as HTMLElement;

describe('TagFilterBar variants (2.1.44)', () => {
  it('[ac:tag-filter-bar-collapsed-one-line] default collapsed variant keeps chips on one line, no wrapping', () => {
    bar();
    expect(strip().className).toContain('flex-nowrap');
    expect(strip().className).not.toContain('flex-wrap');
    const row = host.querySelector<HTMLElement>('[data-tag-row]')!;
    expect(row.style.flexWrap).toBe('nowrap');
    expect(row.style.overflow).toBe('hidden');
  });

  it('[ac:tag-filter-bar-wrap-variant] variant="wrap" wraps chips onto several lines as before', () => {
    bar({ variant: 'wrap' });
    expect(strip().className).toContain('flex-wrap');
    expect(strip().className).not.toContain('flex-nowrap');
    expect(host.querySelector('[data-tag-row]')).toBeNull();
    expect(plus()).toBeUndefined();
    expect(Array.from(host.querySelectorAll('span.rounded-full[role="button"]')).map((c) => c.textContent)).toEqual(NAMES);
  });

  it('[ac:tag-filter-bar-pinned-selected] selected tags stand first and stay visible however few chips fit', () => {
    rowWidth = fitting(2);
    bar({ tagFilter: ['delta', 'epsilon', 'gamma'] });
    const shown = rowChips();
    expect(shown.slice(0, 3)).toEqual(['Gamma', 'Delta', 'Epsilon']);
    expect(shown).toHaveLength(3);
  });

  it('[ac:tag-filter-bar-overflow-count] "+N" shows the number of tags not visible in the line', () => {
    rowWidth = fitting(2);
    bar();
    expect(rowChips()).toEqual(['Alpha', 'Beta']);
    expect(plus()!.textContent).toBe('+3');
  });

  it('[ac:tag-filter-bar-no-overflow] no "+N" when every tag fits', () => {
    rowWidth = 10_000;
    bar();
    expect(rowChips()).toEqual(NAMES);
    expect(plus()).toBeUndefined();
  });

  it('[ac:tag-filter-bar-popover-filter] the "+N" popover narrows its list to the typed filter', () => {
    rowWidth = fitting(2);
    bar();
    act(() => plus()!.click());
    expect(popChips().map((c) => c.textContent)).toEqual(NAMES);
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Filter tags"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, 'ta');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(popChips().map((c) => c.textContent)).toEqual(['Beta', 'Delta']);
  });

  it('[ac:tag-filter-bar-popover-toggle] clicking a chip in the popover calls onTagToggle at once with its slug', () => {
    rowWidth = fitting(2);
    const onTagToggle = vi.fn();
    bar({ onTagToggle });
    act(() => plus()!.click());
    act(() => popChips().find((c) => c.textContent === 'Gamma')!.click());
    expect(onTagToggle).toHaveBeenCalledTimes(1);
    expect(onTagToggle).toHaveBeenCalledWith('gamma');
  });
});

describe('TagFilterBar entityType + counts (2.1.44)', () => {
  const counted: TagFilterBarProps["tags"] = [
    { slug: 'a', name: 'Aaa', counts: { dto: 1, endpoint: 9 } },
    { slug: 'z', name: 'Zzz', counts: { dto: 5, endpoint: 0 } },
    { slug: 'none', name: 'None', counts: { dto: 0, endpoint: 4 } },
    { slug: 'm', name: 'Mmm', counts: { dto: 5 } },
    { slug: 'b', name: 'Bbb', counts: { dto: 3 } },
  ];

  it('[ac:tag-filter-bar-counts-filter] omits tags whose count of the entity type is 0', () => {
    bar({ tags: counted, entityType: 'dto' });
    expect(rowChips()).not.toContain('None');
    expect(rowChips()).toHaveLength(4);
    bar({ tags: counted, entityType: 'endpoint' });
    expect(rowChips()).toEqual(['Aaa', 'None']);
  });

  it('[ac:tag-filter-bar-counts-sort] sorts by count of the type descending, ties alphabetically', () => {
    bar({ tags: counted, entityType: 'dto' });
    expect(rowChips()).toEqual(['Mmm', 'Zzz', 'Bbb', 'Aaa']);
  });

  it('keeps the input order without entityType', () => {
    bar({ tags: counted });
    expect(rowChips()).toEqual(['Aaa', 'Zzz', 'None', 'Mmm', 'Bbb']);
  });
});

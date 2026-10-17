// @vitest-environment happy-dom
/**
 * M34/L12 — `Pagination` (group `list`, `experimental`) against its
 * `ui-kit-component` record `pagination` (2.1.28): pages counted from 1.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Pagination, type PaginationProps } from './Pagination.js';
import type * as Published from '../../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const mount = (el: ReactNode) => act(() => root.render(el));

interface RecordPaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}

const prev = () => host.querySelector<HTMLButtonElement>('button[aria-label="previous page"]')!;
const next = () => host.querySelector<HTMLButtonElement>('button[aria-label="next page"]')!;

describe('Pagination ↔ record `pagination` (M34/L12, 2.1.28)', () => {
  it('[entity:pagination] takes exactly the record props (host and published /ui alike)', () => {
    const a: Same<PaginationProps, RecordPaginationProps> = true;
    const b: Same<Published.PaginationProps, RecordPaginationProps> = true;
    expect([a, b]).toEqual([true, true]);
  });

  it('[entity:pagination] shows the 1-based page of pageCount and asks for the neighbours', () => {
    const onPageChange = vi.fn();
    mount(createElement(Pagination, { page: 2, pageCount: 5, onPageChange }));
    expect(host.textContent).toContain('2 / 5');
    act(() => prev().click());
    act(() => next().click());
    expect(onPageChange.mock.calls).toEqual([[1], [3]]);
  });

  it('[entity:pagination] page 1 has no previous page and the last page no next one', () => {
    const onPageChange = vi.fn();
    mount(createElement(Pagination, { page: 1, pageCount: 1, onPageChange }));
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(true);
    act(() => prev().click());
    act(() => next().click());
    expect(onPageChange).not.toHaveBeenCalled();
  });
});

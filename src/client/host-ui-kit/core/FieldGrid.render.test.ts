// @vitest-environment happy-dom
/**
 * M13 → M34/L12 — `FieldGrid` (group `core`, `stable`, contributed by M13)
 * against its `ui-kit-component` record `field-grid` (2.1.28).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FieldGrid, type FieldGridProps } from './FieldGrid.js';
import { FieldRow } from './FieldRow.js';
import type * as Published from '../../../plugin-types/ui.js';
import { VERSIONED_UI_KIT_COMPONENTS } from '../../../shared/plugin-host/host-api.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The record's `props`. */
interface RecordFieldGridProps {
  children: ReactNode;
  maxWidth?: number;
}

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
});

const mount = (props: FieldGridProps) => act(() => root.render(createElement(FieldGrid, props)));

describe('FieldGrid ↔ record `field-grid` (M13/M34, 2.1.28)', () => {
  it('[entity:field-grid] takes exactly the record props (host and published /ui alike), counted into hostApiVersion as stable', () => {
    const a: Same<FieldGridProps, RecordFieldGridProps> = true;
    const b: Same<Published.FieldGridProps, RecordFieldGridProps> = true;
    expect([a, b]).toEqual([true, true]);
    expect(VERSIONED_UI_KIT_COMPONENTS).toContain('FieldGrid');
  });

  it('[entity:field-grid] defaults maxWidth to 1000 px with padding 16px 32px 48px, and honours a custom maxWidth', () => {
    mount({ children: createElement('span', null, 'a') });
    const grid = host.firstElementChild as HTMLElement;
    expect(grid.style.maxWidth).toBe('1000px');
    expect(grid.style.padding).toBe('16px 32px 48px');
    mount({ children: createElement('span', null, 'a'), maxWidth: 720 });
    expect((host.firstElementChild as HTMLElement).style.maxWidth).toBe('720px');
  });

  it('[ac:ac-fieldgrid-uklada-w-kolumne-wiersze-fi] lays out the FieldRow rows passed as children in a column, rendering no rows of its own', () => {
    mount({
      children: [
        createElement(FieldRow, { key: 'm', label: 'Method', children: 'GET' }),
        createElement(FieldRow, { key: 'p', label: 'Path', children: '/users/:id' }),
      ],
    });
    const grid = host.firstElementChild as HTMLElement;
    // A flex column container…
    expect(grid.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'flex-col']));
    // …whose direct children are exactly the consumer's rows, in order.
    expect(grid.children).toHaveLength(2);
    expect([...grid.children].map((row) => row.textContent)).toEqual(['MethodGET', 'Path/users/:id']);
    // With no children it renders no rows by itself.
    mount({ children: null });
    expect((host.firstElementChild as HTMLElement).children).toHaveLength(0);
  });

  it('[entity:field-grid] has no scrolling of its own: the container sets no overflow, the parent scrolls it', () => {
    mount({
      children: [
        createElement(FieldRow, { key: 'm', label: 'Method', children: 'GET' }),
        createElement(FieldRow, { key: 'p', label: 'Path', children: '/users/:id' }),
      ],
    });
    const grid = host.firstElementChild as HTMLElement;
    expect(grid.style.overflow).toBe('');
    expect(grid.style.overflowY).toBe('');
    expect(grid.style.overflowX).toBe('');
    expect(grid.className).not.toMatch(/overflow/);
    // A height cap would make a scroll box of it; there is none.
    expect(grid.style.height).toBe('');
    expect(grid.style.maxHeight).toBe('');
  });
});

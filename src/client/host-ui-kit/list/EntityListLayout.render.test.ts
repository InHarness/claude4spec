// @vitest-environment happy-dom
/**
 * M34/L12 — `EntityListLayout` (group `list`, `experimental`) against its
 * `ui-kit-component` record `entity-list-layout` (2.1.28).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EntityListLayout, type EntityListLayoutProps } from './EntityListLayout.js';
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

interface RecordEntityListLayoutProps {
  header?: ReactNode;
  children: ReactNode;
}

describe('EntityListLayout ↔ record `entity-list-layout` (M34/L12, 2.1.28)', () => {
  it('[entity:entity-list-layout] takes exactly the record props (host and published /ui alike)', () => {
    const a: Same<EntityListLayoutProps, RecordEntityListLayoutProps> = true;
    const b: Same<Published.EntityListLayoutProps, RecordEntityListLayoutProps> = true;
    expect([a, b]).toEqual([true, true]);
  });

  it('[entity:entity-list-layout] renders the header slot above the children, in a 1000px column padded 16px 32px 48px', () => {
    mount(
      createElement(EntityListLayout, {
        header: createElement('header', { 'data-testid': 'h' }, 'Endpoints'),
        children: createElement('ul', { 'data-testid': 'rows' }),
      }),
    );
    const h = host.querySelector('[data-testid="h"]')!;
    const rows = host.querySelector<HTMLElement>('[data-testid="rows"]')!;
    expect(h.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const column = rows.parentElement!;
    expect(column.style.maxWidth).toBe('1000px');
    expect(column.style.padding).toBe('16px 32px 48px');
  });

  it('[entity:entity-list-layout] the header is optional', () => {
    mount(createElement(EntityListLayout, { children: 'only rows' }));
    expect(host.textContent).toBe('only rows');
  });
});

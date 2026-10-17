// @vitest-environment happy-dom
/**
 * M13 → M34/L12 — `DetailPanelShell` (group `core`, `stable`, contributed by
 * M13) against its `ui-kit-component` record `detail-panel-shell` (2.1.28).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DetailPanelShell, type DetailBreadcrumb, type DetailPanelShellProps } from './DetailPanelShell.js';
import type * as Published from '../../../plugin-types/ui.js';
import { VERSIONED_UI_KIT_COMPONENTS } from '../../../shared/plugin-host/host-api.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The record's `types`: `DetailBreadcrumb = { label: ReactNode; onClick?: () => void; }`. */
interface RecordDetailBreadcrumb {
  label: ReactNode;
  onClick?: () => void;
}
/** The record's `props`. */
interface RecordDetailPanelShellProps {
  breadcrumb: RecordDetailBreadcrumb[];
  actions?: ReactNode;
  children: ReactNode;
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
  vi.restoreAllMocks();
});

const mount = (props: DetailPanelShellProps) => act(() => root.render(createElement(DetailPanelShell, props)));

describe('DetailPanelShell ↔ record `detail-panel-shell` (M13/M34, 2.1.28)', () => {
  it('[entity:detail-panel-shell] takes exactly the record props and DetailBreadcrumb type (host and published /ui alike), counted into hostApiVersion as stable', () => {
    const a: Same<DetailPanelShellProps, RecordDetailPanelShellProps> = true;
    const b: Same<Published.DetailPanelShellProps, RecordDetailPanelShellProps> = true;
    const c: Same<DetailBreadcrumb, RecordDetailBreadcrumb> = true;
    const d: Same<Published.DetailBreadcrumb, RecordDetailBreadcrumb> = true;
    expect([a, b, c, d]).toEqual([true, true, true, true]);
    // No `title` prop, no dedicated Edit/Delete slots.
    const keys: Array<keyof DetailPanelShellProps> = ['breadcrumb', 'actions', 'children'];
    expect(keys).not.toContain('title');
    // The props of a stable record are part of the versioned Host API surface.
    expect(VERSIONED_UI_KIT_COMPONENTS).toContain('DetailPanelShell');
  });

  it('[entity:detail-panel-shell] renders the breadcrumb bar with the actions slot above the child content; earlier hops navigate via onClick', () => {
    const toList = vi.fn();
    mount({
      breadcrumb: [{ label: 'Endpoints', onClick: toList }, { label: 'get-user' }],
      actions: createElement('button', { 'data-testid': 'delete' }, 'Delete'),
      children: createElement('div', { 'data-testid': 'body' }, 'Body content'),
    });
    const bar = host.firstElementChild!.firstElementChild as HTMLElement;
    // The actions slot sits in the bar, the content below it.
    expect(bar.querySelector('[data-testid="delete"]')).not.toBeNull();
    expect(bar.querySelector('[data-testid="body"]')).toBeNull();
    expect(host.querySelector('[data-testid="body"]')?.textContent).toBe('Body content');
    // The first hop is a button wired to its onClick.
    const listCrumb = [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Endpoints')!;
    act(() => listCrumb.click());
    expect(toList).toHaveBeenCalledTimes(1);
    // No Edit button of its own: the only button besides the crumb is the consumer's action.
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Endpoints', 'Delete']);
  });

  it('[ac:ac-detailpanelshell-renderuje-ostatni-cz] renders the last breadcrumb hop as the detail header of the current entity', () => {
    mount({
      breadcrumb: [{ label: 'Endpoints', onClick: () => {} }, { label: 'GET /users/:id', onClick: () => {} }],
      children: createElement('p', null, 'x'),
    });
    const headers = host.querySelectorAll('[role="heading"]');
    // Exactly one header, and it is the last hop — not a separate title.
    expect(headers).toHaveLength(1);
    const header = headers[0] as HTMLElement;
    expect(header.textContent).toBe('GET /users/:id');
    expect(header.getAttribute('aria-level')).toBe('1');
    expect(header.getAttribute('aria-current')).toBe('page');
    expect(header.style.fontWeight).toBe('600');
    // The current entity's hop is not a navigation link, even with an onClick.
    expect(header.closest('button')).toBeNull();
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Endpoints']);
    // The earlier hop is not a header.
    expect(host.querySelector('button')?.getAttribute('role')).toBeNull();
  });
});

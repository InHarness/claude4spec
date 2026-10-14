// @vitest-environment happy-dom
/**
 * M34/L12 — `Dialog` (group `overlay`, `experimental`) rendered for real.
 *
 * 2.1.20: the `maxHeight` prop is gone — the panel's height is closed by the
 * `size` tier, `width` overrides the tier for the width only, and the body is
 * the one scroll container under a pinned footer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dialog, DIALOG_SIZE_TIERS, type DialogProps } from './Dialog.js';
import { UI_KIT_CATALOG } from '../registry.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render(props: Partial<DialogProps> & { children?: DialogProps['children'] }) {
  const full: DialogProps = {
    open: true,
    onClose: () => {},
    children: createElement('p', null, 'body'),
    ...props,
  };
  act(() => root.render(createElement(Dialog, full)));
}

const scrim = () => document.querySelector<HTMLElement>('[role="dialog"]');
const part = (name: string) => document.querySelector<HTMLElement>(`[data-dialog-part="${name}"]`);

describe('Dialog — controlled, presentational modal shell (M34/L12)', () => {
  it('[ac:ac-dialog-grupa-overlay-create-jest-contr] is a catalog entry of group `overlay`, experimental and presentational', () => {
    const entry = UI_KIT_CATALOG.find((c) => c.name === 'Dialog');
    expect(entry).toMatchObject({ group: 'overlay', stability: 'experimental', binding: 'presentational' });
    expect(entry?.l11Surfaces).toBeUndefined();
  });

  it('[ac:ac-dialog-grupa-overlay-create-jest-contr] renders scrim + paper/terra panel only while the consumer holds `open`', () => {
    render({ open: false });
    expect(scrim()).toBeNull();

    render({ open: true, title: 'New thing' });
    const s = scrim()!;
    expect(s).not.toBeNull();
    expect(s.getAttribute('aria-modal')).toBe('true');
    // Scrim: a full-viewport fixed layer.
    expect(s.className).toContain('fixed');
    expect(s.className).toContain('inset-0');
    // Panel styled from the token bridge (`--c-*`).
    const panel = part('panel')!;
    expect(panel.style.background).toBe('var(--c-card)');
    // (happy-dom expands a `var()` border shorthand oddly — read the attribute.)
    expect(panel.getAttribute('style')).toContain('var(--c-hair-strong)');
  });

  it('[ac:ac-dialog-grupa-overlay-create-jest-contr] asks to close but never closes itself — the consumer owns `open`', () => {
    const onClose = vi.fn();
    render({ open: true, onClose, title: 'Edit' });

    // Scrim mousedown, header ✕ and Escape all REQUEST a close…
    act(() => {
      scrim()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(3);
    // …but the dialog is still there: it mutates no state of its own.
    expect(scrim()).not.toBeNull();

    // Only the consumer flipping `open` removes it.
    render({ open: false, onClose });
    expect(scrim()).toBeNull();
  });

  it('[ac:ac-dialog-grupa-overlay-create-jest-contr] traps Tab inside the panel', () => {
    render({
      open: true,
      children: createElement('input', { 'data-testid': 'first' }),
      footer: createElement('button', { type: 'button', 'data-testid': 'last' }, 'Save'),
    });
    const first = document.querySelector<HTMLElement>('[data-testid="first"]')!;
    const last = document.querySelector<HTMLElement>('[data-testid="last"]')!;

    last.focus();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    });
    expect(document.activeElement).toBe(first);

    first.focus();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(last);
  });

  it('[ac:ac-dialog-grupa-overlay-create-jest-contr] fetches nothing — pure-presentational', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render({ open: true, title: 'T', footer: createElement('button', null, 'OK') });
    act(() => {
      vi.runAllTimers();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Dialog — width and the size tier (M34/L12)', () => {
  it('[ac:ac-dialog-przyjmuje-width-number-doklad] an exact `width` wins over the tier for the width', () => {
    render({ open: true, size: 'lg', width: 400 });
    expect(part('panel')!.style.width).toBe('400px');

    render({ open: true, size: 'sm', width: 400 });
    expect(part('panel')!.style.width).toBe('400px');
  });

  it('[ac:ac-dialog-przyjmuje-width-number-doklad] without `width` the tier sets the width (sm = 420px)', () => {
    render({ open: true, size: 'sm' });
    expect(part('panel')!.style.width).toBe(`${DIALOG_SIZE_TIERS.sm.width}px`);
    expect(DIALOG_SIZE_TIERS.sm.width).toBe(420);
    render({ open: true, size: 'lg' });
    expect(part('panel')!.style.width).toBe(`${DIALOG_SIZE_TIERS.lg.width}px`);
  });

  it('[ac:ac-dialog-przyjmuje-width-number-doklad] the height is still closed by the `size` tier when `width` is given', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      render({ open: true, size, width: 400 });
      const withWidth = part('panel')!.style.maxHeight;
      render({ open: true, size });
      const tierOnly = part('panel')!.style.maxHeight;
      expect(withWidth).toBe(DIALOG_SIZE_TIERS[size].maxHeight);
      expect(withWidth).toBe(tierOnly);
    }
  });

  it('[ac:ac-dialog-przyjmuje-width-number-doklad] has no `maxHeight` prop — a passed one does not change the panel height', () => {
    // @ts-expect-error — 2.1.20 removed `maxHeight` from `DialogProps`.
    const props: DialogProps = { open: true, onClose: () => {}, children: 'x', size: 'md', maxHeight: 120 };
    act(() => root.render(createElement(Dialog, props)));
    expect(part('panel')!.style.maxHeight).toBe(DIALOG_SIZE_TIERS.md.maxHeight);
  });
});

describe('Dialog — overflow contract (M34/L12)', () => {
  it('[ac:ac-dialog-scrolluje-wewnetrznie-cialo-przy] the body scrolls inside the tier-capped panel', () => {
    render({ open: true, size: 'sm', title: 'Long', footer: createElement('button', null, 'Save') });
    const panel = part('panel')!;
    const body = part('body')!;
    // Panel: a flex column whose height is capped by the tier.
    expect(panel.className).toContain('flex-col');
    expect(panel.style.maxHeight).toBe(DIALOG_SIZE_TIERS.sm.maxHeight);
    // Body: the scroll container, allowed to shrink below its content.
    expect(body.style.overflowY).toBe('auto');
    expect(body.style.minHeight).toBe('0');
    expect(body.className).toContain('flex-1');
  });

  it('[ac:ac-dialog-scrolluje-wewnetrznie-cialo-przy] the footer is pinned under the body, outside its overflow', () => {
    render({
      open: true,
      size: 'sm',
      children: createElement('div', { style: { height: 5000 } }, 'tall'),
      footer: createElement('button', { 'data-testid': 'save' }, 'Save'),
    });
    const body = part('body')!;
    const footer = part('footer')!;
    // Not inside the scroll container — so scrolling the body never moves it.
    expect(body.contains(footer)).toBe(false);
    // Directly below the body, as the panel's last child, and it never shrinks.
    expect(body.nextElementSibling).toBe(footer);
    expect(part('panel')!.lastElementChild).toBe(footer);
    expect(footer.style.flexShrink).toBe('0');
    expect(footer.contains(document.querySelector('[data-testid="save"]'))).toBe(true);

    // Scrolling the body leaves the footer where it is.
    body.scrollTop = 400;
    expect(body.contains(footer)).toBe(false);
    expect(part('footer')).toBe(footer);
  });
});

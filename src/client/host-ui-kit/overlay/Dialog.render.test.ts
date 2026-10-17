// @vitest-environment happy-dom
/**
 * M34/L12 — `Dialog` (group `overlay`, `experimental`) rendered for real.
 *
 * 2.1.20: the `maxHeight` prop is gone — the panel's height is closed by the
 * `size` tier, `width` overrides the tier for the width only, and the body is
 * the one scroll container under a pinned footer.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dialog, DIALOG_SIZE_TIERS, type DialogProps } from './Dialog.js';
import { UI_KIT_CATALOG } from '../registry.js';
import * as uiBrowserSurface from '../index.js';
import { ConfirmLayer } from '../../ui/ConfirmModal.js';
import { confirmDestructive } from '../../ui/events.js';
import type { DialogProps as PublishedDialogProps } from '../../../plugin-types/ui.js';

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The `dialog` record's `props`, as written (2.1.28). */
interface DialogRecordProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  width?: number;
  dismissible?: boolean;
  ariaLabel?: string;
  zIndex?: number;
}

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** Source without comments — doc comments legitimately NAME the other contract. */
const code = (rel: string) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

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

describe('Dialog ↔ record `dialog` (M34/L12, 2.1.28)', () => {
  it('[entity:dialog] takes exactly the record props (host and published /ui types alike)', () => {
    const hostOk: Same<DialogProps, DialogRecordProps> = true;
    const published: Same<PublishedDialogProps, DialogRecordProps> = true;
    expect([hostOk, published]).toEqual([true, true]);
  });

  it('[entity:dialog] defaults: size md (560px), zIndex 1200, dismissible — Escape requests a close', () => {
    const onClose = vi.fn();
    render({ open: true, onClose });
    expect(part('panel')!.style.width).toBe('560px');
    expect(scrim()!.style.zIndex).toBe('1200');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('[entity:dialog] ariaLabel names a dialog without a title; a title labels it itself', () => {
    render({ open: true, ariaLabel: 'Pick a root' });
    expect(scrim()!.getAttribute('aria-label')).toBe('Pick a root');
    render({ open: true, title: 'New thing' });
    const labelledBy = scrim()!.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelledBy)?.textContent).toBe('New thing');
  });
});

describe('Dialog — header row and ✕ (M34/L12)', () => {
  it('[ac:ac-dialog-renderuje-wiersz-naglowka-z-przyc] with a title it renders the header row with a ✕ (aria-label="Close") that calls onClose()', () => {
    const onClose = vi.fn();
    render({ open: true, onClose, title: 'Edit endpoint' });
    const header = part('header')!;
    expect(header.textContent).toContain('Edit endpoint');
    const close = header.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    expect(close).not.toBeNull();
    act(() => close.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('[ac:ac-dialog-renderuje-wiersz-naglowka-z-przyc] without a title there is no header row and no ✕', () => {
    render({ open: true, ariaLabel: 'Untitled' });
    expect(part('header')).toBeNull();
    expect(document.querySelector('button[aria-label="Close"]')).toBeNull();
  });
});

describe('Dialog — dismissible (M34/L12)', () => {
  it('[ac:ac-dialog-przyjmuje-dismissible-boolean] defaults to true: scrim click, Escape and ✕ each request a close', () => {
    const onClose = vi.fn();
    render({ open: true, onClose, title: 'Edit' });
    act(() => {
      scrim()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('[ac:ac-dialog-przyjmuje-dismissible-boolean] with dismissible={false} neither scrim, Escape nor ✕ closes it — ✕ is not rendered', () => {
    const onClose = vi.fn();
    render({ open: true, onClose, title: 'Trust plugins?', dismissible: false });
    act(() => {
      scrim()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    expect(document.querySelector('button[aria-label="Close"]')).toBeNull();
    // The header stays, with the title alone.
    expect(part('header')!.textContent).toBe('Trust plugins?');
    expect(onClose).not.toHaveBeenCalled();
    expect(scrim()).not.toBeNull();
  });

  it('[ac:ac-dialog-przyjmuje-dismissible-boolean] with dismissible={false} the only exit is the consumer\'s explicit action in footer/children', () => {
    let open = true;
    const answer = vi.fn(() => {
      open = false;
    });
    const draw = () =>
      render({
        open,
        onClose: () => {},
        title: 'Trust plugins?',
        dismissible: false,
        footer: createElement('button', { type: 'button', 'data-testid': 'trust', onClick: answer }, 'Trust'),
      });
    draw();
    act(() => document.querySelector<HTMLButtonElement>('[data-testid="trust"]')!.click());
    expect(answer).toHaveBeenCalledTimes(1);
    draw();
    expect(scrim()).toBeNull();
  });

  it('[ac:ac-dialog-przyjmuje-dismissible-boolean] focus-trap, scrim and panel anatomy are the same with dismissible={false}', () => {
    const props = {
      open: true,
      title: 'T',
      children: createElement('input', { 'data-testid': 'first' }),
      footer: createElement('button', { type: 'button', 'data-testid': 'last' }, 'Answer'),
    };
    render({ ...props, dismissible: true });
    const scrimStyle = scrim()!.getAttribute('style');
    const panelStyle = part('panel')!.getAttribute('style');
    render({ ...props, dismissible: false });
    expect(scrim()!.getAttribute('style')).toBe(scrimStyle);
    expect(part('panel')!.getAttribute('style')).toBe(panelStyle);
    const first = document.querySelector<HTMLElement>('[data-testid="first"]')!;
    const last = document.querySelector<HTMLElement>('[data-testid="last"]')!;
    last.focus();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    });
    expect(document.activeElement).toBe(first);
  });
});

describe('Dialog — onClose in both variants (M34/L12)', () => {
  it('[ac:ac-onclose-jest-wymagany-w-obu-wariantach-d] onClose is required in one props shape, whatever dismissible says (no discriminated union)', () => {
    // @ts-expect-error — onClose is required even for a gate.
    const gateWithout: DialogProps = { open: true, dismissible: false, children: 'x' };
    // @ts-expect-error — and for the default variant.
    const formWithout: DialogProps = { open: true, children: 'x' };
    // One shape: both variants accept the same no-op.
    const gate: DialogProps = { open: true, onClose: () => {}, dismissible: false, children: 'x' };
    const form: DialogProps = { open: true, onClose: () => {}, dismissible: true, children: 'x' };
    expect([gateWithout, formWithout, gate, form].every((p) => p.open)).toBe(true);
    // A discriminated union would make `onClose` optional/never on one branch.
    const required: undefined extends DialogProps['onClose'] ? false : true = true;
    expect(required).toBe(true);
  });

  it('[ac:ac-onclose-jest-wymagany-w-obu-wariantach-d] with dismissible={false} no path of the component calls onClose — the consumer closes by its own state', () => {
    const onClose = vi.fn();
    render({
      open: true,
      onClose,
      title: 'Gate',
      dismissible: false,
      children: createElement('input', null),
      footer: createElement('button', { type: 'button' }, 'Answer'),
    });
    act(() => {
      scrim()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      scrim()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
      vi.runAllTimers();
    });
    expect(onClose).not.toHaveBeenCalled();
    render({ open: false, onClose, dismissible: false });
    expect(scrim()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Dialog — sm tier and the destructive confirm (M34/L12)', () => {
  it('[ac:ac-panel-dialog-w-tierze-size-sm-ma-420px] the sm tier panel is 420px', () => {
    render({ open: true, size: 'sm' });
    expect(DIALOG_SIZE_TIERS.sm.width).toBe(420);
    expect(part('panel')!.style.width).toBe('420px');
  });

  it('[ac:ac-panel-dialog-w-tierze-size-sm-ma-420px] the host destructive-confirm (ConfirmModal) renders at 400px through width={400}, not a tier', async () => {
    act(() => root.render(createElement(ConfirmLayer)));
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = confirmDestructive('entity-delete', { title: 'Delete endpoint?', body: 'This cannot be undone.' });
    });
    expect(part('panel')!.style.width).toBe('400px');
    // The 400px comes from `width`, not from retuning a tier: no tier is 400.
    expect(Object.values(DIALOG_SIZE_TIERS).map((t) => t.width)).not.toContain(400);
    expect(code('../../ui/ConfirmModal.tsx')).toMatch(/<Dialog[\s\S]*?width=\{400\}/);
    expect(code('../../ui/ConfirmModal.tsx')).not.toMatch(/size=/);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await expect(answer).resolves.toBe(false);
  });
});

describe('Dialog — separate from the host-internal ConfirmModal (M34/L12)', () => {
  it('[ac:ac-dialog-jest-odrebny-od-host-internal-con] Dialog is controlled props-in: it knows no host event bus', () => {
    const kit = code('./Dialog.tsx');
    expect(kit).not.toMatch(/from ['"][^'"]*ui\/events/);
    expect(kit).not.toMatch(/UI_EVENTS|addEventListener\(\s*['"]c4s:/);
    expect(kit).not.toMatch(/confirmDestructive/);
    // Visibility is the consumer's `open`, nothing else.
    render({ open: false });
    expect(scrim()).toBeNull();
  });

  it('[ac:ac-dialog-jest-odrebny-od-host-internal-con] ConfirmModal is the event-bus facade that renders the Dialog anatomy — shared anatomy, not shared contract', () => {
    const facade = code('../../ui/ConfirmModal.tsx');
    expect(facade).toMatch(/import \{ Dialog \} from '\.\.\/host-ui-kit\/overlay\/Dialog\.js'/);
    expect(facade).toMatch(/UI_EVENTS\.CONFIRM/);
    // The facade's contract is the imperative request, not Dialog's props.
    expect(Object.keys(uiBrowserSurface)).toContain('Dialog');
    expect(Object.keys(uiBrowserSurface)).not.toContain('ConfirmModal');
    expect(Object.keys(uiBrowserSurface)).not.toContain('ConfirmLayer');
  });
});

describe('Drawer — not in catalog v1 (M34/L12)', () => {
  it('[ac:ac-drawer-boczny-wariant-powloki-side-le] there is no Drawer entry or export, and Dialog has no side variant', () => {
    const names = UI_KIT_CATALOG.map((c) => c.name);
    expect(names.some((n) => /drawer/i.test(n))).toBe(false);
    expect(Object.keys(uiBrowserSurface).some((n) => /drawer/i.test(n))).toBe(false);
    expect(src('../../../plugin-types/ui.ts')).not.toMatch(/\bDrawer\b/);
    // No `side: 'left' | 'right'` on the overlay shell.
    const sideless: 'side' extends keyof DialogProps ? false : true = true;
    expect(sideless).toBe(true);
    expect(code('./Dialog.tsx')).not.toMatch(/\bside\b/);
  });
});

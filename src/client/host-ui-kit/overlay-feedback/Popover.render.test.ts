// @vitest-environment happy-dom
/**
 * M34/L12 — `Popover` (group `feedback`, `experimental`) rendered for real:
 * controlled through `open` / `onClose` / `anchorRef`, presentational, and a
 * contract of its own — the host's `openPopover()` event bus is a facade that
 * renders this anatomy, not this component's API.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Popover, type PopoverProps } from './Popover.js';
import { UI_KIT_CATALOG } from '../registry.js';
import type { PopoverProps as PublishedPopoverProps } from '../../../plugin-types/ui.js';

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The `popover` record's `props`, as written (2.1.28). */
interface PopoverRecordProps {
  open: boolean;
  onClose: () => void;
  anchorRef?: { current: HTMLElement | null };
  at?: { x: number; y: number };
  placement?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
  width?: number;
  title?: string;
  icon?: ReactNode;
  maxHeight?: number;
  footer?: ReactNode;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let anchor: HTMLButtonElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  anchor = document.createElement('button');
  document.body.appendChild(anchor);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  anchor.remove();
  vi.restoreAllMocks();
});

function render(props: Partial<PopoverProps>) {
  const full: PopoverProps = {
    open: true,
    onClose: () => {},
    anchorRef: { current: anchor },
    children: createElement('span', { 'data-testid': 'content' }, 'content'),
    ...props,
  };
  act(() => root.render(createElement(Popover, full)));
}

const panel = () => host.querySelector<HTMLElement>('[role="dialog"]');

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** Source without comments — the kit's doc comment legitimately NAMES the facade. */
const code = (rel: string) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('Popover — controlled feedback panel (M34/L12)', () => {
  it('[ac:ac-popover-grupa-overlay-feedback-m34-exp] is a catalog entry of group `feedback`, experimental and presentational', () => {
    const entry = UI_KIT_CATALOG.find((c) => c.name === 'Popover');
    expect(entry).toMatchObject({ group: 'feedback', stability: 'experimental', binding: 'presentational' });
    expect(entry?.l11Surfaces).toBeUndefined();
  });

  it('[ac:ac-popover-grupa-overlay-feedback-m34-exp] renders only while the consumer holds `open`, anchored over --z-popover', () => {
    render({ open: false });
    expect(panel()).toBeNull();

    render({ open: true });
    const p = panel()!;
    expect(p).not.toBeNull();
    expect(p.style.position).toBe('fixed');
    expect(p.style.zIndex).toBe('var(--z-popover)');
    expect(host.querySelector('[data-testid="content"]')).not.toBeNull();
  });

  it('[ac:ac-popover-grupa-overlay-feedback-m34-exp] requests a close on outside click / Escape but never closes itself', () => {
    const onClose = vi.fn();
    render({ open: true, onClose });

    // A mousedown on the anchor is NOT an outside click.
    act(() => {
      anchor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    // Still rendered: `open` belongs to the consumer.
    expect(panel()).not.toBeNull();

    render({ open: false, onClose });
    expect(panel()).toBeNull();
  });

  it('[ac:ac-popover-grupa-overlay-feedback-m34-exp] fetches nothing — pure-presentational', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render({ open: true, title: 'Pick', footer: createElement('button', null, 'Add') });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('[ac:ac-popover-grupa-overlay-feedback-m34-exp] is separate from the host event-bus Popover/openPopover — shared anatomy, not shared contract', () => {
    const kit = code('./Popover.tsx');
    // The catalog component knows nothing of the host bus: no import of the
    // host's UI events, no `openPopover`, no event listener for popover requests.
    expect(kit).not.toMatch(/from ['"][^'"]*ui\/events/);
    expect(kit).not.toMatch(/openPopover\s*\(/);
    expect(kit).not.toMatch(/UI_EVENTS/);

    // The host's imperative shell is the facade: it imports THIS component to
    // render the anatomy and keeps the event bus on its own side.
    const facade = src('../../ui/Popover.tsx');
    expect(facade).toMatch(/import \{ Popover \} from '\.\.\/host-ui-kit\/overlay-feedback\/Popover\.js'/);
    expect(facade).toMatch(/UI_EVENTS/);
  });
});

describe('Popover ↔ record `popover` (M34/L12, 2.1.28)', () => {
  it('[entity:popover] takes exactly the record props (host and published /ui alike)', () => {
    const hostOk: Same<PopoverProps, PopoverRecordProps> = true;
    const published: Same<PublishedPopoverProps, PopoverRecordProps> = true;
    expect([hostOk, published]).toEqual([true, true]);
  });

  it('[entity:popover] header = icon + title; width fixes the panel, without it the panel fits its content', () => {
    render({ title: 'New endpoint', icon: createElement('i', { 'data-testid': 'icon' }), width: 320 });
    const p = panel()!;
    expect(p.getAttribute('aria-label')).toBe('New endpoint');
    expect(p.textContent).toContain('New endpoint');
    expect(p.querySelector('[data-testid="icon"]')).not.toBeNull();
    expect(p.style.width).toBe('320px');
    render({});
    expect(panel()!.style.width).toBe('');
  });

  it('[entity:popover] positions at caller-given coordinates on the --z-popover layer, without a portal', () => {
    render({ anchorRef: undefined, at: { x: 40, y: 50 } });
    const p = panel()!;
    expect(p.style.position).toBe('fixed');
    expect(p.getAttribute('style')).toContain('var(--z-popover)');
    expect(host.contains(p)).toBe(true);
  });
});

describe('Popover — maxHeight overflow contract (M34/L12)', () => {
  const tall = () => createElement('div', { 'data-testid': 'tall', style: { height: 5000 } }, 'tall');

  it('[ac:ac-popover-z-zadanym-maxheight-scrolluje-we] with maxHeight the panel is capped and the body scrolls inside it instead of overflowing', () => {
    render({ maxHeight: 240, children: tall(), footer: createElement('button', { 'data-testid': 'save' }, 'Save') });
    const p = panel()!;
    expect(p.style.maxHeight).toBe('240px');
    expect(p.style.overflow).toBe('hidden');
    expect(p.className).toContain('flex-col');
    const body = host.querySelector('[data-testid="tall"]')!.parentElement as HTMLElement;
    expect(body.className).toContain('overflow-auto');
    expect(body.style.minHeight).toBe('0');
  });

  it('[ac:ac-popover-z-zadanym-maxheight-scrolluje-we] the footer is pinned under the scrollable body, outside its overflow, whatever the scroll position', () => {
    render({ maxHeight: 240, children: tall(), footer: createElement('button', { 'data-testid': 'save' }, 'Save') });
    const p = panel()!;
    const body = host.querySelector('[data-testid="tall"]')!.parentElement as HTMLElement;
    const footer = host.querySelector('[data-testid="save"]')!.parentElement as HTMLElement;
    expect(body.contains(footer)).toBe(false);
    expect(body.nextElementSibling).toBe(footer);
    expect(p.lastElementChild).toBe(footer);
    body.scrollTop = 1000;
    expect(p.lastElementChild).toBe(footer);
    expect(body.contains(footer)).toBe(false);
  });

  it('[ac:ac-popover-z-zadanym-maxheight-scrolluje-we] without maxHeight there is no cap and no inner scroll container', () => {
    render({ children: tall() });
    const p = panel()!;
    expect(p.style.maxHeight).toBe('');
    const body = host.querySelector('[data-testid="tall"]')!.parentElement as HTMLElement;
    expect(body.className).not.toContain('overflow-auto');
  });
});

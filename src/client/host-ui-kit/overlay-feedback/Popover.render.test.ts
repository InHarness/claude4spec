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
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Popover, type PopoverProps } from './Popover.js';
import { UI_KIT_CATALOG } from '../registry.js';

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

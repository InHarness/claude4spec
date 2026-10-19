// @vitest-environment happy-dom
/**
 * M34/L12 — `Badge` (group `actions`, `experimental`) rendered for real against
 * its `ui-kit-component` record `badge` (2.1.39): a non-interactive value
 * marker — no dot, no button role, never a Tab stop — with the `broken`
 * variant's ⚠ prefix winning over `foreground`. The tag-chip role moved to
 * `TagChip` (see `TagChip.render.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Badge, type BadgeProps } from './Badge.js';
import type { BadgeProps as PublishedBadgeProps } from '../../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The record's `props`, as written (2.1.39). */
interface BadgeRecordProps {
  label: ReactNode;
  small?: boolean;
  foreground?: string;
  mono?: boolean;
  minWidth?: number;
  variant?: 'default' | 'broken';
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

/**
 * Each case on a fresh root: happy-dom keeps a stale `background` shorthand
 * when a `var()` value is patched to a literal, and rejects a
 * `var(--x, fallback)` colour, so a re-render would read the previous chip.
 */
function render(props: BadgeProps) {
  act(() => root.unmount());
  root = createRoot(host);
  act(() => root.render(createElement(Badge, props)));
}

const chip = () => host.firstElementChild as HTMLElement;

describe('Badge ↔ record `badge` (M34/L12, 2.1.39)', () => {
  it('[entity:badge] takes exactly the record props (host and published /ui types alike) — no color, active, onClick, onRemove or dot', () => {
    const hostOk: Same<BadgeProps, BadgeRecordProps> = true;
    const published: Same<PublishedBadgeProps, BadgeRecordProps> = true;
    expect([hostOk, published]).toEqual([true, true]);
  });

  it('[entity:badge] the text is var(--c-ink) by default and foreground overrides it; no #fff constant is left', () => {
    render({ label: 'x' });
    expect(chip().style.color).toBe('var(--c-ink)');
    expect(chip().style.background).toBe('var(--c-panel)');
    render({ label: 'x', foreground: '#abcdef' });
    expect(chip().style.color).toBe('#abcdef');
    expect(chip().getAttribute('style')).not.toContain('#fff');
  });

  it('[entity:badge] mono sets monospace, semibold, tracked type; minWidth fixes a minimum width and centres the text', () => {
    render({ label: '200', mono: true, minWidth: 48 });
    expect(chip().className).toContain('font-mono');
    expect(chip().className).toContain('font-semibold');
    expect(chip().className).toContain('tracking-wide');
    expect(chip().style.minWidth).toBe('48px');
    expect(chip().className).toContain('justify-center');
    render({ label: '200' });
    expect(chip().className).not.toContain('font-mono');
    expect(chip().className).not.toContain('justify-center');
    expect(chip().style.minWidth).toBe('');
  });

  it('[entity:badge] renders no remove button', () => {
    render({ label: 'm34' });
    expect(chip().querySelector('button')).toBeNull();
  });
});

describe('Badge — a non-interactive value marker (M34/L12, 2.1.39)', () => {
  it('[ac:ac-badge-nie-jest-osiagalny-klawiszem-ta] is not a Tab stop: no tabindex, no button role, focus does not land on it', () => {
    render({ label: 'm34' });
    const el = chip();
    expect(el.hasAttribute('tabindex')).toBe(false);
    expect(el.tabIndex).toBe(-1);
    expect(el.hasAttribute('role')).toBe(false);
    el.focus();
    expect(document.activeElement).not.toBe(el);
    // The broken variant is no more focusable than the default one.
    render({ label: 'gone', variant: 'broken' });
    expect(chip().hasAttribute('tabindex')).toBe(false);
    expect(chip().hasAttribute('role')).toBe(false);
  });

  it('[ac:ac-badge-nie-renderuje-kropki-przed-etyk] renders no dot before the label — the label is its only content', () => {
    render({ label: 'm34', small: true, mono: true });
    expect(chip().children).toHaveLength(0);
    expect(chip().querySelector('span.rounded-full')).toBeNull();
    expect(chip().textContent).toBe('m34');
  });

  it('[ac:ac-badge-z-variant-broken-poprzedza-etyk] variant broken puts ⚠ before the label', () => {
    render({ label: 'gone', variant: 'broken' });
    expect(chip().firstElementChild!.textContent).toBe('⚠');
    expect(chip().textContent).toBe('⚠gone');
    render({ label: 'kept' });
    expect(chip().textContent).not.toContain('⚠');
  });

  it('[ac:ac-badge-z-variant-broken-renderuje-wari] variant broken renders red ink and hairline regardless of the given foreground', () => {
    render({ label: 'gone', foreground: '#abcdef', variant: 'broken' });
    expect(chip().getAttribute('style')).toContain('var(--c-red');
    expect(chip().getAttribute('style')).not.toContain('#abcdef');
  });
});

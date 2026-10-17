// @vitest-environment happy-dom
/**
 * M34/L12 — `Badge` (group `actions`, `experimental`) rendered for real against
 * its `ui-kit-component` record `badge` (2.1.28): the props contract, the
 * broken variant, and the one new behaviour of the window — with an `onClick`
 * the chip is reachable with Tab and activated by Enter or Space.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Badge, type BadgeProps } from './Badge.js';
import type { BadgeProps as PublishedBadgeProps } from '../../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The record's `props`, as written. */
interface BadgeRecordProps {
  label: ReactNode;
  color?: string;
  active?: boolean;
  small?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  foreground?: string;
  mono?: boolean;
  dot?: boolean;
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

function render(props: BadgeProps) {
  act(() => root.render(createElement(Badge, props)));
}

const chip = () => host.firstElementChild as HTMLElement;

function press(el: HTMLElement, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('Badge ↔ record `badge` (M34/L12, 2.1.28)', () => {
  it('[entity:badge] takes exactly the record props (host and published /ui types alike)', () => {
    const hostOk: Same<BadgeProps, BadgeRecordProps> = true;
    const published: Same<PublishedBadgeProps, BadgeRecordProps> = true;
    expect([hostOk, published]).toEqual([true, true]);
  });

  it('[entity:badge] renders the label with a leading dot by default, and no dot with dot={false}', () => {
    render({ label: 'm34', color: '#123456' });
    expect(chip().textContent).toContain('m34');
    expect(chip().querySelector('span.rounded-full')).not.toBeNull();
    render({ label: 'm34', dot: false });
    expect(chip().querySelector('span.rounded-full')).toBeNull();
  });

  it('[entity:badge] the remove affordance calls onRemove only, not onClick', () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render({ label: 'm34', onClick, onRemove });
    act(() => {
      chip().querySelector<HTMLButtonElement>('button[aria-label="remove"]')!.click();
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('[entity:badge] variant broken draws the ⚠ prefix and red ink over the given color', () => {
    render({ label: 'gone', color: '#12ab34', active: true, variant: 'broken' });
    expect(chip().textContent).toContain('⚠');
    expect(chip().getAttribute('style')).toContain('var(--c-red');
    expect(chip().getAttribute('style')).not.toContain('#12ab34');
  });
});

describe('Badge — keyboard activation (M34/L12, 2.1.28)', () => {
  it('[ac:ac-badge-z-podanym-onclick-jest-osiagaln] with onClick the chip is in the Tab order and takes focus', () => {
    render({ label: 'm34', onClick: () => {} });
    const el = chip();
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('role')).toBe('button');
    el.focus();
    expect(document.activeElement).toBe(el);
  });

  it('[ac:ac-badge-z-podanym-onclick-jest-osiagaln] without onClick the chip is not a Tab stop', () => {
    render({ label: 'm34' });
    const el = chip();
    expect(el.hasAttribute('tabindex')).toBe(false);
    expect(el.hasAttribute('role')).toBe(false);
  });

  it('[ac:ac-badge-z-podanym-onclick-wywoluje-oncl] Enter calls onClick', () => {
    const onClick = vi.fn();
    render({ label: 'm34', onClick });
    press(chip(), 'Enter');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('[ac:ac-badge-z-podanym-onclick-wywoluje-oncl] Space calls onClick', () => {
    const onClick = vi.fn();
    render({ label: 'm34', onClick });
    press(chip(), ' ');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('[ac:ac-badge-z-podanym-onclick-wywoluje-oncl] other keys, and keys on the nested remove button, do not call onClick', () => {
    const onClick = vi.fn();
    render({ label: 'm34', onClick, onRemove: () => {} });
    press(chip(), 'a');
    press(chip(), 'Tab');
    press(chip().querySelector<HTMLButtonElement>('button[aria-label="remove"]')!, 'Enter');
    expect(onClick).not.toHaveBeenCalled();
  });
});

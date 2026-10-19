// @vitest-environment happy-dom
/**
 * M34/L12 — `TagChip` (group `actions`, `experimental`) rendered for real
 * against its `ui-kit-component` record `tag-chip` (2.1.39): the catalog's one
 * tag chip — a leading dot in `color`, keyboard activation with an `onClick`,
 * a "×" remove that never reaches `onClick`, and no `broken` variant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TagChip, type TagChipProps } from './TagChip.js';
import type { TagChipProps as PublishedTagChipProps } from '../../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The record's `props`, as written. */
interface TagChipRecordProps {
  label: string;
  color?: string;
  active?: boolean;
  small?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
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
 * when a `var()` value is patched to a literal, so a re-render would read the
 * previous chip.
 */
function render(props: TagChipProps) {
  act(() => root.unmount());
  root = createRoot(host);
  act(() => root.render(createElement(TagChip, props)));
}

const chip = () => host.firstElementChild as HTMLElement;
const dotEl = () => chip().firstElementChild as HTMLElement;

function press(el: HTMLElement, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('TagChip ↔ record `tag-chip` (M34/L12, 2.1.39)', () => {
  it('[entity:tag-chip] takes exactly the record props (host and published /ui types alike) — no foreground, mono, dot, minWidth or variant', () => {
    const hostOk: Same<TagChipProps, TagChipRecordProps> = true;
    const published: Same<PublishedTagChipProps, TagChipRecordProps> = true;
    expect([hostOk, published]).toEqual([true, true]);
  });

  it('[entity:tag-chip] carries the catalog constants experimental / presentational', () => {
    expect(TagChip.stability).toBe('experimental');
    expect(TagChip.binding).toBe('presentational');
  });

  it('[entity:tag-chip] color defaults to var(--c-muted); active fills background and border with color and turns dot and text #fff', () => {
    render({ label: 'm34' });
    expect(dotEl().style.background).toBe('var(--c-muted)');
    expect(chip().style.background).toBe('var(--c-panel)');
    expect(chip().style.color).toBe('var(--c-ink)');

    render({ label: 'm34', color: '#123456', active: true });
    expect(chip().style.background).toBe('#123456');
    expect(chip().getAttribute('style')).toMatch(/border[^;]*#123456/);
    expect(chip().style.color).toBe('#fff');
    expect(dotEl().style.background).toBe('#fff');
  });

  it('[entity:tag-chip] has no broken variant — a tag outside the tag map is just its slug in the default colour', () => {
    render({ label: 'ghost-slug' });
    expect(chip().textContent).toBe('ghost-slug');
    expect(chip().textContent).not.toContain('⚠');
    expect(chip().getAttribute('style')).not.toContain('--c-red');
  });

  it('[entity:tag-chip] without onClick it is a plain span — no button role, no Tab stop', () => {
    render({ label: 'm34' });
    expect(chip().hasAttribute('tabindex')).toBe(false);
    expect(chip().hasAttribute('role')).toBe(false);
  });
});

describe('TagChip — acceptance criteria (M34/L12, 2.1.39)', () => {
  it('[ac:ac-tagchip-renderuje-przed-etykieta-krop] renders a dot in the color `color` before the label', () => {
    render({ label: 'm34', color: '#123456' });
    const dot = dotEl();
    expect(dot.className).toContain('rounded-full');
    expect(dot.textContent).toBe('');
    expect(dot.style.background).toBe('#123456');
    // The dot comes first, the label after it.
    expect(chip().firstChild).toBe(dot);
    expect(chip().textContent).toBe('m34');
  });

  it('[ac:ac-tagchip-z-podanym-onclick-jest-osiaga] with onClick the chip is in the Tab order and takes focus', () => {
    render({ label: 'm34', onClick: () => {} });
    const el = chip();
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('role')).toBe('button');
    el.focus();
    expect(document.activeElement).toBe(el);
  });

  it('[ac:ac-tagchip-z-podanym-onclick-wywoluje-on] Enter and Space call onClick', () => {
    const onClick = vi.fn();
    render({ label: 'm34', onClick });
    press(chip(), 'Enter');
    press(chip(), ' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('[ac:ac-tagchip-z-podanym-onclick-wywoluje-on] other keys, and keys on the nested remove button, do not call onClick', () => {
    const onClick = vi.fn();
    render({ label: 'm34', onClick, onRemove: () => {} });
    press(chip(), 'a');
    press(chip(), 'Tab');
    press(chip().querySelector<HTMLButtonElement>('button[aria-label="remove"]')!, 'Enter');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('[ac:ac-klikniecie-tagchip-z-podanym-onremove] clicking "×" calls onRemove and not onClick', () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render({ label: 'm34', onClick, onRemove });
    const remove = chip().querySelector<HTMLButtonElement>('button')!;
    expect(remove.getAttribute('aria-label')).toBe('remove');
    expect(remove.textContent).toBe('×');
    act(() => remove.click());
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    render({ label: 'm34' });
    expect(chip().querySelector('button')).toBeNull();
  });
});

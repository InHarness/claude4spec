// @vitest-environment happy-dom
/**
 * M34/L12 — `EnumBadgePicker` (group `pickers`, `experimental`) against its
 * `ui-kit-component` record `enum-badge-picker` (2.1.28): a coloured
 * badge-with-dropdown over any enum, props-in, its dropdown the published
 * `Popover`; the badge itself is not the catalog `Badge`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EnumBadgePicker, type EnumBadgePickerProps } from './EnumBadgePicker.js';
import type * as Published from '../../../plugin-types/ui.js';

// Resolved with node:path from the module's own file path — under happy-dom the global `URL`
// is the window's, so `new URL(rel, import.meta.url)` is not a `file:` URL that `fileURLToPath`
// accepts (same pattern as tokens.render.test.ts).
const HERE = dirname(fileURLToPath(import.meta.url));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

interface RecordEnumBadgePickerProps {
  options: { value: string; label: string; color?: string }[];
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
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

const mount = (props: EnumBadgePickerProps) => act(() => root.render(createElement(EnumBadgePicker, props)));
const click = (el: Element) => act(() => (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));
const byLabel = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === label);

const METHODS = [
  { value: 'GET', label: 'GET', color: 'var(--c-green)' },
  { value: 'POST', label: 'POST', color: 'var(--c-blue)' },
  { value: 'DELETE', label: 'DELETE', color: 'var(--c-red)' },
];

describe('EnumBadgePicker ↔ record `enum-badge-picker` (M34/L12, 2.1.28)', () => {
  it('[entity:enum-badge-picker] takes exactly the record props (host and published /ui alike)', () => {
    const a: Same<EnumBadgePickerProps, RecordEnumBadgePickerProps> = true;
    const b: Same<Published.EnumBadgePickerProps, RecordEnumBadgePickerProps> = true;
    expect([a, b]).toEqual([true, true]);
  });

  it('[ac:ac-enumbadgepicker-grupa-pickers-m34-expe] a coloured badge for the current value of any enum opens its options in the published Popover, and a pick is the author callback', () => {
    const onChange = vi.fn();
    mount({ options: METHODS, value: 'POST', onChange });
    const badge = byLabel('POST')[0]!;
    expect(badge.getAttribute('style')).toContain('var(--c-blue)');
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    click(badge);
    const popover = host.querySelector('[role="dialog"]')!;
    expect(popover).not.toBeNull();
    expect(Array.from(popover.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['GET', 'POST', 'DELETE']);
    click(Array.from(popover.querySelectorAll('button')).find((b) => b.textContent === 'DELETE')!);
    expect(onChange).toHaveBeenCalledWith('DELETE');
    // Props-in: the shown value is still the prop until the author passes a new one.
    expect(byLabel('POST').length).toBe(1);
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    // Any enum, not only HTTP methods.
    mount({ options: [{ value: 'draft', label: 'Draft' }, { value: 'done', label: 'Done' }], value: 'done', onChange });
    expect(byLabel('Done').length).toBe(1);
  });

  it('[ac:ac-enumbadgepicker-grupa-pickers-m34-expe] the dropdown is the published Popover and the badge is no catalog Badge; readOnly opens nothing', () => {
    const src = readFileSync(resolve(HERE, './EnumBadgePicker.tsx'), 'utf8');
    expect(src).toMatch(/import \{ Popover \} from '\.\.\/overlay-feedback\/Popover\.js'/);
    expect(src).toMatch(/<Popover\b/);
    expect(src).not.toMatch(/import \{[^}]*\bBadge\b[^}]*\} from/);
    expect(src).not.toMatch(/<Badge\b/);

    const onChange = vi.fn();
    mount({ options: METHODS, value: 'GET', onChange, readOnly: true });
    click(byLabel('GET')[0]!);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

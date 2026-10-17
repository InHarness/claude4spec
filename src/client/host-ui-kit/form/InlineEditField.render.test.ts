// @vitest-environment happy-dom
/**
 * M34/L12 — `InlineEditField` (group `form`, `experimental`) against its
 * `ui-kit-component` record `inline-edit-field` (2.1.28).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { InlineEditField, type InlineEditFieldProps } from './InlineEditField.js';
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

interface RecordInlineEditFieldProps {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const key = (el: HTMLElement, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });

describe('InlineEditField ↔ record `inline-edit-field` (M34/L12, 2.1.28)', () => {
  it('[entity:inline-edit-field] takes exactly the record props (host and published /ui alike)', () => {
    const a: Same<InlineEditFieldProps, RecordInlineEditFieldProps> = true;
    const b: Same<Published.InlineEditFieldProps, RecordInlineEditFieldProps> = true;
    expect([a, b]).toEqual([true, true]);
  });

  it('[entity:inline-edit-field] shows the value (or placeholder), turns into an input on click and commits on Enter', () => {
    const onCommit = vi.fn();
    mount(createElement(InlineEditField, { value: '', onCommit, placeholder: 'Add a slug', mono: true }));
    const display = host.querySelector('button')!;
    expect(display.textContent).toBe('Add a slug');
    expect(display.className).toContain('font-mono');
    act(() => display.click());
    const input = host.querySelector('input')!;
    type(input, 'users-get');
    key(input, 'Enter');
    expect(onCommit).toHaveBeenCalledWith('users-get');
  });

  it('[entity:inline-edit-field] an unchanged value commits nothing; the committed value is the prop', () => {
    const onCommit = vi.fn();
    mount(createElement(InlineEditField, { value: 'a', onCommit }));
    expect(host.querySelector('button')!.textContent).toBe('a');
    act(() => host.querySelector('button')!.click());
    expect(host.querySelector('input')!.value).toBe('a');
    key(host.querySelector('input')!, 'Enter');
    expect(onCommit).not.toHaveBeenCalled();
    expect(host.querySelector('button')!.textContent).toBe('a');
  });
});

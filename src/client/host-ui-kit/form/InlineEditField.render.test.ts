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
const keyEvent = (el: HTMLElement, k: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
/** React's `onBlur` listens to `focusout`. */
const blurEvent = (el: HTMLElement) => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
const key = (el: HTMLElement, k: string) =>
  act(() => {
    keyEvent(el, k);
  });
/**
 * The key, then the blur the input fires as it leaves the DOM — in ONE act, so
 * the blur runs the handler of the render before the key's update re-rendered
 * (the stale closure a browser's removal-blur hits).
 */
const keyThenBlur = (el: HTMLElement, k: string) =>
  act(() => {
    keyEvent(el, k);
    blurEvent(el);
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

  it('[entity:inline-edit-field] Enter then the unmount blur commits exactly once', () => {
    const onCommit = vi.fn();
    mount(createElement(InlineEditField, { value: 'a', onCommit }));
    act(() => host.querySelector('button')!.click());
    const input = host.querySelector('input')!;
    type(input, 'b');
    keyThenBlur(input, 'Enter');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('b');
    // The input left the DOM; a stray blur on it reaches nothing either.
    expect(host.querySelector('input')).toBeNull();
    act(() => {
      blurEvent(input);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('[entity:inline-edit-field] Escape reverts: neither Escape nor the blur that follows it commits the edited draft', () => {
    const onCommit = vi.fn();
    mount(createElement(InlineEditField, { value: 'a', onCommit }));
    act(() => host.querySelector('button')!.click());
    const input = host.querySelector('input')!;
    type(input, 'edited');
    keyThenBlur(input, 'Escape');
    expect(onCommit).not.toHaveBeenCalled();
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('button')!.textContent).toBe('a');
  });

  it('[entity:inline-edit-field] a blur without Enter commits once; the next edit commits again', () => {
    const onCommit = vi.fn();
    mount(createElement(InlineEditField, { value: 'a', onCommit }));
    act(() => host.querySelector('button')!.click());
    const first = host.querySelector('input')!;
    type(first, 'b');
    act(() => {
      blurEvent(first);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith('b');
    expect(host.querySelector('input')).toBeNull();

    // A new edit is a new settle: Enter commits it (once).
    act(() => host.querySelector('button')!.click());
    const second = host.querySelector('input')!;
    type(second, 'c');
    keyThenBlur(second, 'Enter');
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith('c');
  });
});

describe('InlineEditField — mono in both states (M34/L12, 2.1.33)', () => {
  it('[entity:inline-edit-field] mono sets the monospace face on the value and on the input; without it neither is monospace', () => {
    mount(createElement(InlineEditField, { value: 'users-get', onCommit: () => {}, mono: true }));
    expect(host.querySelector('button')!.className).toContain('font-mono');
    act(() => host.querySelector('button')!.click());
    expect(host.querySelector('input')!.className).toContain('font-mono');

    act(() => root.unmount());
    root = createRoot(host);
    mount(createElement(InlineEditField, { value: 'Users', onCommit: () => {} }));
    expect(host.querySelector('button')!.className).not.toContain('font-mono');
  });
});

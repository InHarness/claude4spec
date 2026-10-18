// @vitest-environment happy-dom
/**
 * M34/L12 — `FormField` (group `form`, `experimental`) against its
 * `ui-kit-component` record `form-field` (2.1.28).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormField, type FormFieldProps } from './FormField.js';
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

interface RecordFormFieldProps {
  label: ReactNode;
  error?: string | null;
  children: ReactNode;
}

describe('FormField ↔ record `form-field` (M34/L12, 2.1.28)', () => {
  it('[entity:form-field] takes exactly the record props (host and published /ui alike)', () => {
    const a: Same<FormFieldProps, RecordFormFieldProps> = true;
    const b: Same<Published.FormFieldProps, RecordFormFieldProps> = true;
    expect([a, b]).toEqual([true, true]);
  });

  it('[entity:form-field] renders the label above the control it wraps, and the error below it', () => {
    mount(createElement(FormField, { label: 'Slug', error: 'Slug taken', children: createElement('input', { 'data-testid': 'c' }) }));
    const field = host.firstElementChild!;
    const [label, control, error] = Array.from(field.children);
    expect(label!.textContent).toBe('Slug');
    expect(control!.getAttribute('data-testid')).toBe('c');
    expect(error!.textContent).toBe('Slug taken');
    // The error line is drawn in the red token. happy-dom drops a `var(--x, fallback)` colour from
    // the live style attribute, so the drawn style is read from React's own serialisation.
    const markup = renderToStaticMarkup(
      createElement(FormField, { label: 'Slug', error: 'Slug taken', children: createElement('input') }),
    );
    expect(markup).toMatch(/<div[^>]*style="color:var\(--c-red[^"]*"[^>]*>Slug taken<\/div>/);
  });

  it('[entity:form-field] no error line without an error (null or absent)', () => {
    mount(createElement(FormField, { label: 'Slug', error: null, children: createElement('input') }));
    expect(host.firstElementChild!.children).toHaveLength(2);
    mount(createElement(FormField, { label: 'Slug', children: createElement('input') }));
    expect(host.firstElementChild!.children).toHaveLength(2);
  });
});

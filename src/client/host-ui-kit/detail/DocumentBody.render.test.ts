// @vitest-environment happy-dom
/**
 * M13 → M34/L12 — `DocumentBody` (group `detail`, `experimental`, contributed
 * by M13) against its `ui-kit-component` record `document-body` (2.1.28).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DocumentBody, type DocumentBodyProps } from './DocumentBody.js';
import type * as Published from '../../../plugin-types/ui.js';
import { VERSIONED_UI_KIT_COMPONENTS } from '../../../shared/plugin-host/host-api.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The record's `props`. */
interface RecordDocumentBodyProps {
  title?: { value: string; onChange?(v: string): void; placeholder?: string };
  children: ReactNode;
  maxWidth?: number;
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

const mount = (props: DocumentBodyProps) => act(() => root.render(createElement(DocumentBody, props)));

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('DocumentBody ↔ record `document-body` (M13/M34, 2.1.28)', () => {
  it('[entity:document-body] takes exactly the record props (host and published /ui alike); experimental, so outside hostApiVersion', () => {
    const a: Same<DocumentBodyProps, RecordDocumentBodyProps> = true;
    const b: Same<Published.DocumentBodyProps, RecordDocumentBodyProps> = true;
    expect([a, b]).toEqual([true, true]);
    expect(VERSIONED_UI_KIT_COMPONENTS as readonly string[]).not.toContain('DocumentBody');
  });

  it('[entity:document-body] defaults maxWidth to 1000 px with padding 16px 32px 48px; the title is optional and read-only without onChange', () => {
    mount({ children: createElement('p', null, 'Text') });
    const body = host.firstElementChild as HTMLElement;
    expect(body.style.maxWidth).toBe('1000px');
    expect(body.style.padding).toBe('16px 32px 48px');
    expect(host.querySelector('input')).toBeNull();
    mount({ title: { value: 'Read only' }, children: null, maxWidth: 800 });
    expect((host.firstElementChild as HTMLElement).style.maxWidth).toBe('800px');
    expect(host.querySelector('input')?.readOnly).toBe(true);
  });

  it('[ac:ac-documentbody-kontrybuowany-przez-m13-e] renders a freeform single-column document: a large inline-editable heading-1 title and content in the bridge lede/body styles, not a FieldGrid label↔value grid', () => {
    const onChange = vi.fn();
    mount({
      title: { value: 'Checkout flow', onChange, placeholder: 'Untitled' },
      children: [
        createElement('p', { key: 'l', className: 'lede' }, 'Lead paragraph'),
        createElement('p', { key: 'b' }, 'Body paragraph'),
      ],
    });
    // Large inline-editable title, styled as `heading-1` from the token bridge.
    const title = host.querySelector('input')!;
    expect(title.value).toBe('Checkout flow');
    expect(title.placeholder).toBe('Untitled');
    expect(title.readOnly).toBe(false);
    expect(title.style.fontFamily).toBe('var(--font-heading)');
    expect(title.style.fontSize).toBe('var(--text-h1)');
    expect(title.style.fontWeight).toBe('var(--weight-heading)');
    type(title, 'Checkout v2');
    expect(onChange).toHaveBeenCalledWith('Checkout v2');

    // Content in `body` …
    const content = host.querySelector('[data-c4s-document-body]') as HTMLElement;
    expect(content.style.fontFamily).toBe('var(--font-body)');
    expect(content.style.fontSize).toBe('var(--text-body)');
    expect(content.style.fontWeight).toBe('var(--weight-body)');
    expect(content.textContent).toBe('Lead paragraph' + 'Body paragraph');
    // … with a `lede` paragraph on the bridge's lede variables.
    const css = [...host.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).toMatch(/\[data-c4s-document-body\] p\.lede\{[^}]*font-family:var\(--font-heading\)/);
    expect(css).toMatch(/p\.lede\{[^}]*font-size:var\(--text-lede\)/);
    expect(css).toMatch(/p\.lede\{[^}]*font-weight:var\(--weight-lede\)/);
    expect(css).toMatch(/p\.lede\{[^}]*font-style:italic/);

    // Single column of loose content, no 140 px label↔value grid.
    const body = host.firstElementChild as HTMLElement;
    expect(body.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'flex-col']));
    expect(host.innerHTML).not.toMatch(/width:\s*140px/);
    expect(host.querySelectorAll('[style*="140"]')).toHaveLength(0);
  });
});

// @vitest-environment happy-dom
/**
 * M34/L12 — `RichTextField` (group `detail`, `experimental`) against its
 * `ui-kit-component` record `rich-text-field` (2.1.28): a props-in
 * rich-markdown editor (bold/italic/headings/lists/tables/code), not a
 * `<textarea>` stub, with no host wiring; `readOnly` blocks editing.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { RichTextField, type RichTextFieldProps, type RichTextFieldToolbarItem } from './RichTextField.js';
import type * as Published from '../../../plugin-types/ui.js';

// Resolved with node:path from the module's own file path — under happy-dom the global `URL`
// is the window's, so `new URL(rel, import.meta.url)` is not a `file:` URL that `fileURLToPath`
// accepts (same pattern as tokens.render.test.ts).
const HERE = dirname(fileURLToPath(import.meta.url));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

type RecordToolbarItem = 'bold' | 'italic' | 'heading' | 'list' | 'table' | 'code';
interface RecordRichTextFieldProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  toolbar?: RecordToolbarItem[];
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

async function mount(props: RichTextFieldProps): Promise<Editor> {
  await act(async () => {
    root.render(createElement(RichTextField, props));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  const dom = host.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null;
  expect(dom?.editor).toBeTruthy();
  return dom!.editor!;
}

const BASICS = [
  '## Heading',
  '',
  'Some **bold** and *italic* text.',
  '',
  '- one',
  '- two',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```',
  'const x = 1;',
  '```',
].join('\n');

describe('RichTextField ↔ record `rich-text-field` (M34/L12, 2.1.28)', () => {
  it('[entity:rich-text-field] takes exactly the record props and toolbar type (host and published /ui alike)', () => {
    const a: Same<RichTextFieldProps, RecordRichTextFieldProps> = true;
    const b: Same<Published.RichTextFieldProps, RecordRichTextFieldProps> = true;
    const c: Same<RichTextFieldToolbarItem, RecordToolbarItem> = true;
    const d: Same<Published.RichTextFieldToolbarItem, RecordToolbarItem> = true;
    expect([a, b, c, d]).toEqual([true, true, true, true]);
  });

  it('[entity:rich-text-field] renders the default toolbar (bold, italic, heading, list, table, code) and the default placeholder "Write…"', async () => {
    await mount({ value: '', onChange: () => {} });
    const items = Array.from(host.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(items).toEqual(['bold', 'italic', 'heading', 'list', 'table', 'code']);
    expect(host.innerHTML).toContain('Write…');
    await mount({ value: '', onChange: () => {}, toolbar: ['bold'], placeholder: 'Describe it' });
    expect(Array.from(host.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual(['bold']);
  });

  it('[ac:ac-komponent-richtextfield-m34-experim] renders the description editor from value and reports edits through onChange — props-in, no fetch, no host wiring', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const onChange = vi.fn();
    const editor = await mount({ value: 'Hello', onChange });
    expect(editor.getText()).toBe('Hello');
    await act(async () => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' there');
    });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0]).toBe('Hello there');
    expect(fetchSpy).not.toHaveBeenCalled();
    const src = readFileSync(resolve(HERE, './RichTextField.tsx'), 'utf8');
    for (const hostOnly of ['useQueryClient', 'EditorBridge', 'editorBridge', 'getEditorExtensions', 'EditorFactory']) {
      expect(src.replace(/\/\*[\s\S]*?\*\//g, ''), hostOnly).not.toContain(hostOnly);
    }
  });

  it('[ac:ac-richtextfield-m34-experimental-render] renders the rich-markdown basics — bold, italic, headings, lists, tables, code — and is no textarea; readOnly blocks editing', async () => {
    await mount({ value: BASICS, onChange: () => {} });
    const pm = host.querySelector('.ProseMirror')!;
    expect(pm.querySelector('h2')?.textContent).toBe('Heading');
    expect(pm.querySelector('strong')?.textContent).toBe('bold');
    expect(pm.querySelector('em')?.textContent).toBe('italic');
    expect(pm.querySelectorAll('ul > li').length).toBe(2);
    expect(pm.querySelector('table')).not.toBeNull();
    expect(pm.querySelector('pre code')?.textContent).toContain('const x = 1;');
    expect(host.querySelector('textarea')).toBeNull();
    expect(pm.getAttribute('contenteditable')).toBe('true');

    await mount({ value: BASICS, onChange: () => {}, readOnly: true });
    expect(host.querySelector('.ProseMirror')!.getAttribute('contenteditable')).toBe('false');
  });

  it('[ac:ac-richtextfield-w-trybie-readonly-rend] readOnly renders the description content without a way to edit it', async () => {
    const onChange = vi.fn();
    const editor = await mount({ value: 'Read **me**', onChange, readOnly: true });
    const pm = host.querySelector('.ProseMirror')!;
    // The content is there…
    expect(pm.querySelector('strong')?.textContent).toBe('me');
    expect(editor.getText()).toBe('Read me');
    // …but nothing to edit it with: not editable, no formatting toolbar.
    expect(pm.getAttribute('contenteditable')).toBe('false');
    expect(editor.isEditable).toBe(false);
    expect(host.querySelectorAll('button').length).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});

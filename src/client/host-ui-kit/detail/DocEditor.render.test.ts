// @vitest-environment happy-dom
/**
 * 2.1.25 (M34 `m34l12sc` — Panel detalu, `DocEditor`). The catalog's connected
 * description editor does two things `RichTextField` cannot: it runs
 * slash-commands, and it lets the user insert a link to another entity. Each
 * behaviour is pinned on its own, on the real `DocEditor` mounted with a host
 * `QueryClient` — the same component `/ui` hands to plugins.
 *
 *  - slash-commands: typing `/` opens the palette of the editor's context
 *    (L8 `description`: `/mention`), and picking an entry runs that command;
 *  - link to another entity: `/mention` → the host's entity picker → the chosen
 *    `{ type, slug }` lands in the document as an `<inline_mention/>` and is
 *    handed up through `onChange` as markdown.
 *
 * What is stood in for, and why:
 *  - `ReactRenderer` (`@tiptap/react`) is a recorder: the test reads the props
 *    the slash popover was last rendered with, as `SlashMenu` would
 *    (pattern: `tiptap/extensions/SlashCommands.narrow.test.ts`);
 *  - `ReactNodeViewRenderer` returns a bare `<span>`: the chip a mention renders
 *    resolves its entity over the network, which this test does not exercise;
 *  - the host's entity picker is the `c4s:popover-open` window event
 *    (`ui/events.ts#openPopover`); the test answers it as the picker would;
 *  - `coordsAtPos` returns a fixed rect: happy-dom does no layout;
 *  - happy-dom's selector parser rejects element names with an underscore
 *    (`inline_mention`); the shim gives a bare type selector of that form the
 *    browser's answer (pattern: `tiptap/pageEditor.formatting.test.ts`).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Editor } from '@tiptap/core';

type SlashItem = { key: string };
type SlashProps = { items: SlashItem[]; command: (item: SlashItem) => void };

const recorded = vi.hoisted(() => ({ renderers: [] as Array<{ props: SlashProps }> }));

vi.mock('@tiptap/react', async (importOriginal) => {
  const real = await importOriginal<typeof import('@tiptap/react')>();
  class RecordingRenderer {
    element = document.createElement('div');
    ref = null;
    props: unknown;
    constructor(_component: unknown, options: { props: unknown }) {
      this.props = options.props;
      recorded.renderers.push(this as never);
    }
    updateProps(props: Record<string, unknown>) {
      this.props = { ...(this.props as Record<string, unknown>), ...props };
    }
    destroy() {}
  }
  return {
    ...real,
    ReactRenderer: RecordingRenderer,
    ReactNodeViewRenderer: () => () => ({ dom: document.createElement('span') }),
  };
});

import { DocEditor, type DocEditorProps } from './DocEditor.js';
import type * as Published from '../../../plugin-types/ui.js';
import type { PopoverRequest } from '../../ui/events.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── happy-dom: bare type selectors with an underscore ──
const UNDERSCORE_TYPE = /^[a-zA-Z][\w-]*_[\w-]*$/;
function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of selector) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}
function withUnderscoreTypeSelectors(): () => void {
  const proto = Element.prototype;
  const nativeMatches = proto.matches;
  const nativeQueryAll = proto.querySelectorAll;
  const needsShim = (selector: string) => splitSelectorList(selector).some((p) => UNDERSCORE_TYPE.test(p));
  function matches(this: Element, selector: string): boolean {
    if (!needsShim(selector)) return nativeMatches.call(this, selector);
    return splitSelectorList(selector).some((part) =>
      UNDERSCORE_TYPE.test(part) ? this.tagName.toLowerCase() === part.toLowerCase() : nativeMatches.call(this, part),
    );
  }
  function querySelectorAll(this: Element, selector: string) {
    if (!needsShim(selector)) return nativeQueryAll.call(this, selector);
    return Array.from(nativeQueryAll.call(this, '*')).filter((el) => matches.call(el, selector));
  }
  proto.matches = matches;
  (proto as { querySelectorAll: unknown }).querySelectorAll = querySelectorAll;
  return () => {
    proto.matches = nativeMatches;
    proto.querySelectorAll = nativeQueryAll;
  };
}

let restoreSelectors: (() => void) | null = null;
beforeAll(() => {
  restoreSelectors = withUnderscoreTypeSelectors();
});
afterAll(() => {
  restoreSelectors?.();
  restoreSelectors = null;
});

// ── mount ──
let host: HTMLDivElement;
let root: Root;
let changes: string[];
let popovers: PopoverRequest[];
const onPopover = (e: Event) => popovers.push((e as CustomEvent<PopoverRequest>).detail);

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  recorded.renderers.length = 0;
  changes = [];
  popovers = [];
  window.addEventListener('c4s:popover-open', onPopover);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  window.removeEventListener('c4s:popover-open', onPopover);
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

/** Mount the real `DocEditor` under a host `QueryClient`; return its live tiptap editor. */
async function mountDocEditor(value = ''): Promise<Editor> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(DocEditor, { value, onChange: (md: string) => changes.push(md) }),
      ),
    );
  });
  await flush();
  const dom = host.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null;
  expect(dom?.editor).toBeTruthy();
  const editor = dom!.editor!;
  // No layout in happy-dom: give the caret a position for the popover anchor.
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 10, right: 10, top: 20, bottom: 30 });
  return editor;
}

/** Type `text` (ending in `/`) at the caret, as keystrokes would, and let the palette list. */
async function typeSlash(editor: Editor, text = '/'): Promise<SlashProps> {
  await act(async () => {
    editor.view.dispatch(editor.state.tr.insertText(text));
  });
  await flush();
  expect(recorded.renderers.length).toBeGreaterThan(0);
  return recorded.renderers.at(-1)!.props;
}

/** Pick `/mention` in the open palette. */
async function pickMention(palette: SlashProps): Promise<void> {
  const mention = palette.items.find((i) => i.key === 'command:mention');
  expect(mention).toBeDefined();
  await act(async () => {
    palette.command(mention!);
  });
  await flush();
}

describe('DocEditor (M34, connected) — slash-commands and links to other entities', () => {
  it('[ac:ac-doceditor-obsluguje-slash-commands] typing / opens the slash palette with the description commands, and picking one runs it', async () => {
    const editor = await mountDocEditor();

    const palette = await typeSlash(editor);
    const keys = palette.items.map((i) => i.key);
    // The L8 `description` context's palette: `/mention`, not the page-only commands.
    expect(keys).toContain('command:mention');
    for (const pageOnly of ['command:todo', 'command:section', 'command:element', 'command:list']) {
      expect(keys).not.toContain(pageOnly);
    }

    await pickMention(palette);
    // The command ran: the typed `/` is consumed and the command's window — the
    // host's entity picker — was opened at the caret.
    expect(editor.state.doc.textContent).toBe('');
    expect(popovers.map((p) => p.kind)).toEqual(['mention']);
    expect(popovers[0]).toMatchObject({ x: 10, y: 36 });

    // Cancelling the window leaves the document as it was.
    await act(async () => {
      popovers[0]!.onCancel();
    });
    await flush();
    let mentions = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'inline_mention') mentions += 1;
    });
    expect(mentions).toBe(0);
  });

  it('[ac:ac-doceditor-pozwala-wstawic-odnosnik-do] the entity picked in the editor is inserted as a link to that entity and handed up as markdown', async () => {
    const editor = await mountDocEditor('See');
    // Caret at the end of the seeded text.
    await act(async () => {
      editor.commands.focus('end');
    });

    // ` /` — the palette opens after a space, as in running text.
    await pickMention(await typeSlash(editor, ' /'));
    expect(popovers.map((p) => p.kind)).toEqual(['mention']);

    // The user picks another entity in the host's picker.
    await act(async () => {
      (popovers[0] as PopoverRequest<'mention'>).onSubmit({ type: 'dto', slug: 'user-response' });
    });
    await flush();

    // The document holds a link node to exactly that entity…
    const links: Array<Record<string, unknown>> = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'inline_mention') links.push(n.attrs);
    });
    expect(links).toEqual([{ type: 'dto', slug: 'user-response' }]);
    expect(editor.state.doc.textContent).toBe('See ');

    // …and the panel receives it as the reference tag in the description markdown.
    expect(changes.at(-1)).toContain('See <inline_mention type="dto" slug="user-response"/>');
  });
});

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The record's `props` (`doc-editor`, 2.1.28). */
interface RecordDocEditorProps {
  value: string;
  onChange: (md: string) => void;
  onBlur?: () => void;
  readOnly?: boolean;
  placeholder?: string;
}

describe('DocEditor ↔ record `doc-editor` (M34/L12, 2.1.28)', () => {
  it('[entity:doc-editor] takes exactly the record props (host and published /ui alike)', () => {
    const a: Same<DocEditorProps, RecordDocEditorProps> = true;
    const b: Same<Published.DocEditorProps, RecordDocEditorProps> = true;
    expect([a, b]).toEqual([true, true]);
  });

  it('[entity:doc-editor] binds the live host QueryClient and renders the value, with the record default placeholder "Description…"', async () => {
    const editor = await mountDocEditor('Hello world');
    expect(editor.getText()).toBe('Hello world');
    await act(async () => {
      editor.commands.setContent('', false);
    });
    await flush();
    expect(host.innerHTML).toContain('Description…');
  });
});

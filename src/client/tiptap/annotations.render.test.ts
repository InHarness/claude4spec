// @vitest-environment happy-dom
/**
 * M53 (Agent Chat Shell, `annotcmp`, `9x9xm07q`) — annotations: the popup on a
 * selection in the editor, the cards in the chat's annotation panel, and the
 * highlight the editor draws for them (a ProseMirror decoration, page-bound).
 *
 * A headless tiptap editor (no React node views); `coordsAtPos` is stubbed —
 * happy-dom has no layout — so the popup gets a position at all.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import './registrations.js';
import { xmlTagNode } from './extensions/xmlNodes.js';
import {
  AnnotationHighlight,
  annotationPluginKey,
  annotationSelectionText,
  refreshAnnotations,
} from './extensions/AnnotationHighlight.js';
import { AnnotationBubble } from './AnnotationBubble.js';
import { AnnotationPanel } from '../chat/AnnotationPanel.js';
import { useChatStore } from '../state/chat.js';
import type { Annotation } from '../../shared/entities.js';
import type { DecorationSet } from '@tiptap/pm/view';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const text = (t: string): JSONContent => ({ type: 'text', text: t });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

let editors: Editor[] = [];
let host: HTMLDivElement;
let root: Root;

/** A page editor with the annotation highlight, reading annotations from the chat store. */
function pageEditor(content: JSONContent, currentPage = 'a.md', extra: Editor['extensionManager']['extensions'] = []) {
  const editor = new Editor({
    extensions: [
      StarterKit,
      ...extra,
      AnnotationHighlight.configure({ getAnnotations: () => useChatStore.getState().annotations, currentPage }),
    ],
    content,
  });
  editor.view.coordsAtPos = () => ({ left: 40, right: 40, top: 100, bottom: 112 });
  editors.push(editor);
  return editor;
}

const highlights = (editor: Editor) => [...editor.view.dom.querySelectorAll('.anno-hl')].map((el) => el.textContent);

beforeEach(() => {
  useChatStore.setState({ chatOpen: false, annotations: [] });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  for (const e of editors) e.destroy();
  editors = [];
});

const ann = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'a1',
  text: 'world',
  comment: 'is this right?',
  page: 'a.md',
  range: { from: 7, to: 12 },
  ...over,
});

function select(editor: Editor, from: number, to: number) {
  act(() => {
    editor.commands.setTextSelection({ from, to });
  });
}
const buttons = () => [...host.querySelectorAll('button')];
const byText = (t: string) => buttons().find((b) => b.textContent?.trim() === t);
const click = (el: Element | undefined) => {
  expect(el).toBeTruthy();
  act(() => (el as HTMLElement).click());
};
const renderBubble = (editor: Editor, page = 'a.md') =>
  act(() => root.render(createElement(AnnotationBubble, { editor: editor as never, currentPage: page })));

describe('adding an annotation', () => {
  it('[ac:ac-zaznaczenie-tekstu-w-edytorze-pokazuj] a text selection in the editor shows the annotation popup', () => {
    const editor = pageEditor(doc(para(text('Hello world here'))));
    renderBubble(editor);
    expect(byText('+ Add to chat')).toBeUndefined();
    select(editor, 7, 12);
    expect(byText('+ Add to chat')).toBeDefined();
    // A collapsed selection hides it again.
    select(editor, 7, 7);
    expect(byText('+ Add to chat')).toBeUndefined();
  });

  it('[ac:ac-skrot-cmd-shift-a-otwiera-popup-adnot] Cmd+Shift+A opens the annotation popup for the current selection', () => {
    const editor = pageEditor(doc(para(text('Hello world here'))));
    renderBubble(editor);
    select(editor, 7, 12);
    expect(host.querySelector('textarea')).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, shiftKey: true }));
    });
    expect(host.querySelector('textarea')).not.toBeNull();
    expect(host.textContent).toContain('"world"');
  });

  it('[ac:ac-akcja-dodaj-do-chatu-tworzy-karte-adn] "Add to chat" creates an annotation card in the chat panel', () => {
    const editor = pageEditor(doc(para(text('Hello world here'))));
    renderBubble(editor);
    select(editor, 7, 12);
    click(byText('+ Add to chat'));
    const box = host.querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(box, 'check this');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(byText('Add to chat'));
    const [card] = useChatStore.getState().annotations;
    expect(card).toMatchObject({ text: 'world', comment: 'check this', page: 'a.md', range: { from: 7, to: 12 } });
    // The panel shows the card.
    const panel = document.createElement('div');
    const panelRoot = createRoot(panel);
    act(() => panelRoot.render(createElement(AnnotationPanel)));
    expect(panel.textContent).toContain('Annotations (1)');
    expect(panel.textContent).toContain('"world"');
    expect(panel.textContent).toContain('check this');
    act(() => panelRoot.unmount());
  });

  it('[ac:ac-adnotacja-z-pustym-komentarzem-jest-d] an annotation with an empty comment is allowed — the selected text is enough', () => {
    const editor = pageEditor(doc(para(text('Hello world here'))));
    renderBubble(editor);
    select(editor, 1, 6);
    click(byText('+ Add to chat'));
    click(byText('Add to chat'));
    expect(useChatStore.getState().annotations).toHaveLength(1);
    expect(useChatStore.getState().annotations[0]).toMatchObject({ text: 'Hello', comment: '' });
  });

  it('[ac:ac-zaznaczenie-tekstu-w-poprzek-node-ow] a selection across nodes (heading + paragraph) is taken as plain text with editor.state.doc.textBetween(from, to)', () => {
    const editor = pageEditor(
      doc({ type: 'heading', attrs: { level: 1 }, content: [text('Title')] }, para(text('Body text'))),
    );
    renderBubble(editor);
    select(editor, 1, 17);
    click(byText('+ Add to chat'));
    click(byText('Add to chat'));
    const saved = useChatStore.getState().annotations[0]!.text;
    expect(saved).toBe('Title Body text');
    expect(saved).toBe(editor.state.doc.textBetween(1, 17, ' '));
  });

  it('[ac:ac-zaznaczenie-obejmujace-custom-xml-nod] a selection over a custom XML node (an entity reference) takes the entity\'s rendered text, not the raw XML', () => {
    const editor = pageEditor(
      doc(para(text('Call '), { type: 'inline_mention', attrs: { type: 'endpoint', slug: 'get-users' } }, text(' now'))),
      'a.md',
      [xmlTagNode('inline_mention')],
    );
    // What the chip's node view shows for that entity.
    const realNodeDOM = editor.view.nodeDOM.bind(editor.view);
    editor.view.nodeDOM = (pos: number) => {
      if (pos !== 6) return realNodeDOM(pos);
      const chip = document.createElement('span');
      chip.textContent = 'GET /api/users';
      return chip;
    };
    renderBubble(editor);
    select(editor, 1, 11);
    click(byText('+ Add to chat'));
    click(byText('Add to chat'));
    const saved = useChatStore.getState().annotations[0]!.text;
    expect(saved).toBe('Call GET /api/users now');
    expect(saved).not.toContain('<');
    expect(saved).not.toContain('inline_mention');
    // The pure helper behaves the same for any renderer of the leaf.
    expect(annotationSelectionText(editor.state.doc, 1, 11, () => '[chip]')).toBe('Call [chip] now');
  });

  it('[ac:ac-utworzenie-adnotacji-przy-zamknietym] creating an annotation while the chat is closed opens the chat panel', () => {
    const editor = pageEditor(doc(para(text('Hello world here'))));
    renderBubble(editor);
    expect(useChatStore.getState().chatOpen).toBe(false);
    select(editor, 7, 12);
    click(byText('+ Add to chat'));
    click(byText('Add to chat'));
    expect(useChatStore.getState().chatOpen).toBe(true);
  });
});

describe('the annotation panel', () => {
  const renderPanel = () => act(() => root.render(createElement(AnnotationPanel)));

  it('[ac:ac-karte-adnotacji-mozna-edytowac-w-pane] an annotation card can be edited in the chat panel before sending', () => {
    useChatStore.setState({ annotations: [ann()] });
    renderPanel();
    click(host.querySelector('button[title="Edit"]')!);
    const box = host.querySelector('textarea')!;
    act(() => {
      box.value = 'a sharper question';
      box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(useChatStore.getState().annotations[0]!.comment).toBe('a sharper question');
    expect(host.textContent).toContain('a sharper question');
  });

  it('[ac:ac-karte-adnotacji-mozna-usunac-z-panelu] an annotation card can be removed from the chat panel before sending, taking its highlight along', () => {
    useChatStore.setState({ annotations: [ann(), ann({ id: 'a2', text: 'Hello', range: { from: 1, to: 6 } })] });
    const editor = pageEditor(doc(para(text('Hello world here'))));
    const unsub = useChatStore.subscribe(() => refreshAnnotations(editor.view));
    renderPanel();
    expect(highlights(editor).sort()).toEqual(['Hello', 'world']);
    click(host.querySelectorAll('button[title="Remove"]')[0]!);
    expect(useChatStore.getState().annotations.map((a) => a.id)).toEqual(['a2']);
    expect(highlights(editor)).toEqual(['Hello']);
    unsub();
  });

  it('[ac:ac-akcja-wyczysc-wszystko-usuwa-wszystki] "Clear all" removes every annotation and its highlight in the editor', () => {
    useChatStore.setState({ annotations: [ann(), ann({ id: 'a2', text: 'Hello', range: { from: 1, to: 6 } })] });
    const editor = pageEditor(doc(para(text('Hello world here'))));
    // The page editor refreshes its highlights whenever the store's annotations change.
    const unsub = useChatStore.subscribe(() => refreshAnnotations(editor.view));
    renderPanel();
    expect(highlights(editor)).toHaveLength(2);
    click(byText('Clear all'));
    expect(useChatStore.getState().annotations).toEqual([]);
    expect(highlights(editor)).toEqual([]);
    expect(host.textContent).toBe('');
    unsub();
  });
});

describe('highlights in the editor', () => {
  it('[ac:ac-adnotacje-sa-podswietlone-w-edytorze] annotations are highlighted in the editor through ProseMirror Decorations', () => {
    useChatStore.setState({ annotations: [ann()] });
    const editor = pageEditor(doc(para(text('Hello world here'))));
    const set = annotationPluginKey.getState(editor.state) as DecorationSet;
    const decos = set.find();
    expect(decos).toHaveLength(1);
    expect(decos[0]).toMatchObject({ from: 7, to: 12 });
    expect(highlights(editor)).toEqual(['world']);
    expect(editor.view.dom.querySelector('.anno-hl')!.getAttribute('title')).toBe('is this right?');
    // A decoration, not a mark: the document itself is unchanged.
    expect(editor.getJSON()).toEqual(doc(para(text('Hello world here'))));
  });

  it('[ac:ac-highlighty-adnotacji-sa-widoczne-wyla] highlights show only on the active page, while the panel lists annotations from every page', () => {
    useChatStore.setState({
      annotations: [ann(), ann({ id: 'b1', page: 'b.md', text: 'Hello', range: { from: 1, to: 6 } })],
    });
    const onA = pageEditor(doc(para(text('Hello world here'))), 'a.md');
    expect(highlights(onA)).toEqual(['world']);
    const onB = pageEditor(doc(para(text('Hello world here'))), 'b.md');
    expect(highlights(onB)).toEqual(['Hello']);
    act(() => root.render(createElement(AnnotationPanel)));
    expect(host.textContent).toContain('Annotations (2)');
  });

  it('[ac:ac-edycja-dokumentu-po-ktorej-range-adno] an edit after which the annotation range no longer matches its original text removes the highlight decoration', () => {
    useChatStore.setState({ annotations: [ann()] });
    const editor = pageEditor(doc(para(text('Hello world here'))));
    // An edit before the range only moves it.
    act(() => {
      editor.commands.insertContentAt(1, text('Oh, '));
    });
    expect(highlights(editor)).toEqual(['world']);
    // An edit inside it breaks the match: the highlight goes.
    const at = editor.state.doc.textContent.indexOf('world') + 1 + 2;
    act(() => {
      editor.commands.insertContentAt(at, text('X'));
    });
    expect(editor.state.doc.textContent).toContain('woXrld');
    expect(highlights(editor)).toEqual([]);
  });

  it('[section:9x9xm07q] a refresh after an edit before the range keeps the highlight on its moved range', () => {
    useChatStore.setState({ annotations: [ann()] });
    const editor = pageEditor(doc(para(text('Hello world here'))));
    act(() => {
      editor.commands.insertContentAt(1, text('Oh, '));
    });
    expect(highlights(editor)).toEqual(['world']);
    // The store still holds the range as created (7–12); a refresh — e.g. a
    // comment edited or another annotation added — keeps the mapped one.
    act(() => useChatStore.getState().updateAnnotation('a1', 'edited'));
    act(() => refreshAnnotations(editor.view));
    expect(useChatStore.getState().annotations[0]!.range).toEqual({ from: 7, to: 12 });
    expect(highlights(editor)).toEqual(['world']);
    const [deco] = (annotationPluginKey.getState(editor.state) as DecorationSet).find();
    expect(deco).toMatchObject({ from: 11, to: 16 });
    expect(editor.view.dom.querySelector('.anno-hl')!.getAttribute('title')).toBe('edited');
  });

  it('[ac:ac-adnotacja-ktorej-highlight-przestal-p] an annotation whose highlight stopped matching after an edit stays in the store with its original text snapshot', () => {
    useChatStore.setState({ annotations: [ann()] });
    const editor = pageEditor(doc(para(text('Hello world here'))));
    act(() => {
      editor.commands.insertContentAt(9, text('X'));
    });
    expect(highlights(editor)).toEqual([]);
    // A later refresh does not bring it back on the broken range either.
    act(() => refreshAnnotations(editor.view));
    expect(highlights(editor)).toEqual([]);
    expect(useChatStore.getState().annotations).toEqual([ann()]);
  });
});

// @vitest-environment happy-dom
/**
 * M02 — a click on a page in the tree routes to `/space/<root>/<path>`; for a
 * `.md` path `PageRouteBody` (`router.tsx`) mounts the tiptap `Editor`, which
 * seeds itself with `editor.commands.setContent(data.body)` from the
 * `page-detail` read (`components/Editor.tsx`). This pins what that seeding
 * produces: the page editor's own extension list (`EditorFactory.buildExtensions('page', …)`,
 * the list `Editor` passes to `useEditor`) turns the body of a `page-detail`
 * into a formatted document — headings by level, marks, lists, quotes, code,
 * tables, task lists — not a markdown source shown as text.
 *
 * happy-dom's selector parser rejects element names with an underscore
 * (`raw_jsx_block`, `single_element`, … — valid CSS type selectors a browser
 * accepts), and both `tiptap-markdown` (`normalizeBlocks`: one
 * `querySelectorAll` over every block node's `parseDOM` tag) and ProseMirror's
 * `DOMParser` (`matches(dom, rule.tag)`) build selectors from those names.
 * `withUnderscoreTypeSelectors` gives `Element.prototype.matches` /
 * `querySelectorAll` the browser's answer for a bare type selector with an
 * underscore (tag name equality) and hands every other selector to happy-dom
 * unchanged — the editor itself runs as is.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import './registrations.js';
import { EditorFactory } from './EditorFactory.js';
import { FULL_ROOT_EDITOR_PROPS } from './contextSpec.js';
import type { RegistryContext } from './registry.js';
import type { PageDetail } from '../../shared/types.js';

const ctx: RegistryContext = {
  qc: {} as RegistryContext['qc'],
  currentPath: 'guides/formatting.md',
  rootId: 'pages',
  onSlashInvoke: () => {},
  getAnnotations: () => [],
};

const BODY = [
  '# Title',
  '',
  '## Section',
  '',
  'Text with **bold**, *italic*, ~~strike~~ and `code`.',
  '',
  '- first',
  '- second',
  '',
  '1. one',
  '2. two',
  '',
  '- [x] done',
  '- [ ] todo',
  '',
  '> quoted',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '---',
  '',
].join('\n');

const detail: PageDetail = {
  rootId: 'pages',
  path: 'guides/formatting.md',
  title: 'Title',
  frontmatter: {},
  body: BODY,
  content: BODY,
} as PageDetail;

/** A bare type selector happy-dom cannot parse: an element name with an underscore. */
const UNDERSCORE_TYPE = /^[a-zA-Z][\w-]*_[\w-]*$/;

/** Split a selector list on its top-level commas (none inside `[...]`, `(...)` or quotes). */
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
      UNDERSCORE_TYPE.test(part)
        ? this.tagName.toLowerCase() === part.toLowerCase()
        : nativeMatches.call(this, part),
    );
  }
  function querySelectorAll(this: Element, selector: string) {
    if (!needsShim(selector)) return nativeQueryAll.call(this, selector);
    // Every descendant in document order, kept when it matches the list.
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

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('the page editor renders a page with its formatting (M02)', () => {
  it('[ac:ac-klik-na-strone-otwiera-ja-w-tiptap-z-pel] the page-detail body opened in the tiptap page editor becomes formatted nodes and marks, not markdown text', () => {
    editor = new Editor({
      extensions: EditorFactory.buildExtensions('page', ctx, {}, FULL_ROOT_EDITOR_PROPS),
      content: '',
    });
    // What `Editor.tsx` does with the `page-detail` it read.
    editor.commands.setContent(detail.body, false);

    const nodes: Array<{ type: string; attrs: Record<string, unknown>; text: string }> = [];
    const marks = new Set<string>();
    editor.state.doc.descendants((n) => {
      nodes.push({ type: n.type.name, attrs: n.attrs, text: n.textContent });
      for (const m of n.marks) marks.add(m.type.name);
    });
    const types = new Set(nodes.map((n) => n.type));

    // Headings by level, not `#` text.
    const headings = nodes.filter((n) => n.type === 'heading').map((n) => [n.attrs.level, n.text]);
    expect(headings).toEqual([
      [1, 'Title'],
      [2, 'Section'],
    ]);
    // Inline formatting as marks — the marks the page editor registers
    // (StarterKit: bold, italic, strike, code; it has no Link extension).
    for (const mark of ['bold', 'italic', 'strike', 'code']) expect(marks).toContain(mark);
    // Block formatting as nodes.
    for (const type of [
      'bulletList',
      'orderedList',
      'listItem',
      'taskList',
      'taskItem',
      'blockquote',
      'codeBlock',
      'table',
      'tableRow',
      'tableHeader',
      'tableCell',
      'horizontalRule',
    ]) {
      expect(types).toContain(type);
    }
    expect(nodes.find((n) => n.type === 'codeBlock')?.attrs.language).toBe('ts');

    // No markdown syntax survives as visible text.
    const text = editor.state.doc.textContent;
    for (const syntax of ['# ', '**', '~~', '```', '| ---', '- [x]', '> ']) expect(text).not.toContain(syntax);

    // And the formatting is kept when the editor serializes it back for a save.
    const md = editor.storage.markdown.getMarkdown() as string;
    expect(md).toContain('# Title');
    expect(md).toContain('**bold**');
    expect(md).toContain('```ts');
  });
});

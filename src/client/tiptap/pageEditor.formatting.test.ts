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
 */

import { afterEach, describe, expect, it } from 'vitest';
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

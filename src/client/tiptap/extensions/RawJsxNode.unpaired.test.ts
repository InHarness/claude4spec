// @vitest-environment happy-dom
/**
 * 2.1.65 — M20 `lb9dq0ed` / `m20mdxjsx` / `wry28ibe` / `m20edge0`, M51
 * `5wf420mr` / `c1m5maz3`: the editor's second raw JSX rule, inline, next to
 * the block one (M51's region rule). A tag quoted in inline code stays code;
 * an unpaired tag, in prose or alone on its line, becomes a raw node of the
 * tag alone while the rest of the paragraph stays markdown with live chips; a
 * pair split by an inline-block, table-cell or container boundary is two
 * unpaired tags. Every case comes back to disk byte for byte.
 *
 * Each case runs through the page editor itself: the markdown is seeded the
 * way `Editor.tsx` seeds a page (`setContent(body)` — tiptap-markdown's
 * markdown-it with the editor's rules, then the DOM step), and what a save
 * writes is `storage.markdown.getMarkdown()`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { Editor } from '@tiptap/core';
import '../registrations.js';
import { EditorFactory } from '../EditorFactory.js';
import { FULL_ROOT_EDITOR_PROPS } from '../contextSpec.js';
import type { RegistryContext } from '../registry.js';
import { setupRawJsxRules } from './RawJsxNode.js';
import { unescapeRawAttr } from '../../../shared/raw-jsx-escape.js';
import { withUnderscoreTypeSelectors } from '../../../../tests/helpers/underscore-type-selectors.js';

const ctx: RegistryContext = {
  qc: {} as RegistryContext['qc'],
  currentPath: 'guides/jsx.md',
  rootId: 'pages',
  onSlashInvoke: () => {},
  getAnnotations: () => [],
};

const MENTION = '<inline_mention type="dto" slug="user"/>';

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

/** Open `markdown` in the page editor, as `Editor.tsx` does with a page body. */
function open(markdown: string): Editor {
  editor = new Editor({
    extensions: EditorFactory.buildExtensions('page', ctx, {}, FULL_ROOT_EDITOR_PROPS),
    content: '',
  });
  editor.commands.setContent(markdown, false);
  return editor;
}

/** What a save writes back. */
const save = (e: Editor): string => e.storage.markdown.getMarkdown() as string;

interface DocNode {
  type: string;
  attrs: Record<string, unknown>;
  text: string;
  marks: string[];
}

function nodes(e: Editor): DocNode[] {
  const out: DocNode[] = [];
  e.state.doc.descendants((n) => {
    out.push({
      type: n.type.name,
      attrs: n.attrs,
      text: n.isText ? (n.text ?? '') : '',
      marks: n.marks.map((m) => m.type.name),
    });
  });
  return out;
}

const raws = (e: Editor, type = 'raw_jsx_inline') =>
  nodes(e)
    .filter((n) => n.type === type)
    .map((n) => n.attrs.raw);
const chips = (e: Editor) => nodes(e).filter((n) => n.type === 'inline_mention');

/** markdown-it tokens of the editor's raw rules alone (block and inline children flattened). */
function tokens(src: string): Array<{ type: string; content: string; raw?: string }> {
  const md = new MarkdownIt({ html: true, breaks: false, linkify: false });
  setupRawJsxRules(md);
  const out: Array<{ type: string; content: string; raw?: string }> = [];
  const visit = (list: any[]) => {
    for (const t of list) {
      const m = /data-c4s-raw="([^"]*)"/.exec(t.content ?? '');
      out.push({ type: t.type, content: t.content, ...(m ? { raw: unescapeRawAttr(m[1]!) } : {}) });
      if (t.children) visit(t.children);
    }
  };
  visit(md.parse(src, {}));
  return out;
}

describe('M20 — unknown JSX tags, paired, self-closing and unpaired, back byte for byte', () => {
  it('[ac:ac-roundtrip-markdown-tiptap-markdown-j] self-closing, paired and unpaired component tags come back from the editor byte for byte, with no fence', () => {
    const src = [
      'Intro <Icon name="x"/> text.',
      '',
      '<Callout type="info">',
      'body',
      '</Callout>',
      '',
      'Unpaired <Callout> and <ui.Card kind="a"> here.',
    ].join('\n');
    const e = open(src);
    expect(raws(e, 'raw_jsx_block')).toEqual(['<Callout type="info">\nbody\n</Callout>']);
    expect(raws(e)).toEqual(['<Icon name="x"/>', '<Callout>', '<ui.Card kind="a">']);
    const out = save(e);
    expect(out).toBe(src);
    expect(out).not.toContain('```');
  });
});

describe('M20 — a JSX tag quoted in inline code stays code', () => {
  const SRC = 'Use `<Callout>…</Callout>` here.';

  it('[ac:m20-inline-code-jsx-renders-as-code] `<Callout>…</Callout>` quoted in inline code renders as inline code, no raw node', () => {
    const toks = tokens(SRC);
    expect(toks.filter((t) => t.type === 'code_inline').map((t) => t.content)).toEqual(['<Callout>…</Callout>']);
    expect(toks.filter((t) => t.raw !== undefined)).toEqual([]);

    const e = open(SRC);
    const code = nodes(e).filter((n) => n.marks.includes('code'));
    expect(code.map((n) => n.text)).toEqual(['<Callout>…</Callout>']);
    expect(raws(e)).toEqual([]);
    expect(raws(e, 'raw_jsx_block')).toEqual([]);
  });

  it('[ac:m20-inline-code-jsx-roundtrip] a paragraph with `<Callout>…</Callout>` in inline code comes back byte for byte', () => {
    expect(save(open(SRC))).toBe(SRC);
  });
});

describe('M20 — between inline code and a tag the earlier construct wins', () => {
  it('[ac:m20-jsx-earlier-construct-wins] in <Callout>a ` b</Callout> <marker/> ` c the marker renders as a chip', () => {
    const src = `<Callout>a \` b</Callout> ${MENTION} \` c`;
    const e = open(src);
    // The tag starts before the backtick inside it: the region wins, so that
    // backtick opens no code and cannot pair with the one after the marker.
    expect(raws(e)).toEqual(['<Callout>a ` b</Callout>']);
    expect(chips(e).map((n) => [n.attrs.type, n.attrs.slug])).toEqual([['dto', 'user']]);
    expect(nodes(e).filter((n) => n.marks.includes('code'))).toEqual([]);
  });
});

describe('M20 — an unpaired JSX tag is a raw node of the tag alone', () => {
  it('[ac:m20-unpaired-jsx-opener-raw-node] an unpaired <Callout> in a paragraph renders as a raw node holding only the tag', () => {
    const e = open('Text <Callout> and more.');
    const para = nodes(e).filter((n) => n.type !== 'paragraph');
    expect(para.map((n) => (n.type === 'text' ? n.text : `${n.type}:${String(n.attrs.raw)}`))).toEqual([
      'Text ',
      'raw_jsx_inline:<Callout>',
      ' and more.',
    ]);
  });

  it('[ac:m20-unpaired-jsx-opener-roundtrip] a paragraph with an unpaired <Callout> comes back byte for byte', () => {
    const src = 'Text <Callout> and more.\n\nNext paragraph.';
    expect(save(open(src))).toBe(src);
  });

  it('[ac:m20-unpaired-jsx-opener-attrs-roundtrip] a paragraph with an unpaired <Callout type="info"> comes back byte for byte', () => {
    const src = 'Text <Callout type="info"> and more.';
    const e = open(src);
    expect(raws(e)).toEqual(['<Callout type="info">']);
    expect(save(e)).toBe(src);
  });

  it('[ac:m20-unpaired-jsx-opener-following-marker-is-chip] a registered marker after an unpaired <Callout> in a paragraph renders as a chip', () => {
    const e = open(`Text <Callout> then ${MENTION} end.`);
    expect(raws(e)).toEqual(['<Callout>']);
    expect(chips(e).map((n) => [n.attrs.type, n.attrs.slug])).toEqual([['dto', 'user']]);
  });
});

describe('M20 — an unpaired JSX tag alone on its line', () => {
  it('[ac:m20-unpaired-jsx-opener-own-line-next-line-chip] a registered marker on the line under an unpaired <Callout> alone on its line renders as a chip', () => {
    const src = `<Callout>\n${MENTION}`;
    // Not a block region and not raw HTML: the line starts a paragraph.
    const toks = tokens(src);
    expect(toks.map((t) => t.type)).not.toContain('html_block');
    expect(toks[0]!.type).toBe('paragraph_open');

    const e = open(src);
    expect(raws(e, 'raw_jsx_block')).toEqual([]);
    expect(raws(e)).toEqual(['<Callout>']);
    expect(chips(e).map((n) => [n.attrs.type, n.attrs.slug])).toEqual([['dto', 'user']]);
  });

  it('[ac:m20-unpaired-jsx-opener-own-line-roundtrip] an unpaired <Callout> alone on its line comes back byte for byte', () => {
    const src = 'Intro.\n\n<Callout>\n\nOutro.';
    const e = open(src);
    expect(raws(e)).toEqual(['<Callout>']);
    expect(save(e)).toBe(src);
  });
});

describe('M20 — a pair split by a boundary is two unpaired tags', () => {
  it('[ac:m20-split-jsx-pair-roundtrip] "a <Callout>b", blank line, "c</Callout> d" comes back byte for byte', () => {
    const src = 'a <Callout>b\n\nc</Callout> d';
    const e = open(src);
    // Each half in its own raw node; the text around them stays prose.
    expect(raws(e)).toEqual(['<Callout>', '</Callout>']);
    expect(save(e)).toBe(src);
  });

  it('[ac:m20-split-jsx-pair-table-cell-roundtrip] a table row with <Callout> in one cell and </Callout> in the next comes back byte for byte', () => {
    const src = ['Intro.', '', '| A | B |', '| --- | --- |', '| <Callout> | </Callout> |', '', 'Outro.'].join('\n');
    const e = open(src);
    expect(raws(e)).toEqual(['<Callout>', '</Callout>']);
    expect(save(e)).toBe(src);
  });

  it('a pair split by a block-quote boundary is two unpaired tags, not a block region', () => {
    const toks = tokens('> <Callout>\n> quoted\n\n</Callout>');
    expect(toks.filter((t) => t.type === 'html_block')).toEqual([]);
    expect(toks.filter((t) => t.raw !== undefined).map((t) => t.raw)).toEqual(['<Callout>', '</Callout>']);
  });
});

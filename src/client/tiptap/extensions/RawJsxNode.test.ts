import { describe, expect, it, beforeEach } from 'vitest';
import MarkdownIt from 'markdown-it';
import { setupRawJsxRules, RawJsxBlockNode, RawJsxInlineNode } from './RawJsxNode.js';
import { unescapeRawAttr } from '../../../shared/raw-jsx-escape.js';

function makeMd(): MarkdownIt {
  const md = new MarkdownIt({ html: true, breaks: false, linkify: false });
  setupRawJsxRules(md);
  return md;
}

/** All tokens, flattening inline children, that carry a raw-jsx payload. */
function rawTokens(md: MarkdownIt, src: string): Array<{ type: string; raw: string }> {
  const out: Array<{ type: string; raw: string }> = [];
  const visit = (tokens: any[]) => {
    for (const t of tokens) {
      if (typeof t.content === 'string' && t.content.includes('data-c4s-raw')) {
        const m = /data-c4s-raw="([^"]*)"/.exec(t.content);
        // model the DOM attribute decode that getAttribute performs at runtime
        out.push({ type: t.type, raw: m ? unescapeRawAttr(m[1]!) : '' });
      }
      if (t.children) visit(t.children);
    }
  };
  visit(md.parse(src, {}));
  return out;
}

/** Minimal MarkdownSerializerState stand-in. */
function fakeState() {
  return {
    out: '',
    write(s: string) {
      this.out += s;
    },
    closeBlock() {
      /* block separation handled by real state; irrelevant to verbatim bytes */
    },
  };
}

function serializeBlock(raw: string): string {
  const st = fakeState();
  (RawJsxBlockNode as any).config.addStorage().markdown.serialize(st, { attrs: { raw } });
  return st.out;
}

function serializeInline(raw: string): string {
  const st = fakeState();
  (RawJsxInlineNode as any).config.addStorage().markdown.serialize(st, { attrs: { raw } });
  return st.out;
}

describe('setupRawJsxRules — capture of unknown JSX tags', () => {
  let md: MarkdownIt;
  beforeEach(() => {
    md = makeMd();
  });

  it('captures a mid-prose self-closing component as an inline raw node', () => {
    const toks = rawTokens(md, 'text <Icon name="x"/> more');
    expect(toks).toHaveLength(1);
    expect(toks[0]!.type).toBe('html_inline');
    expect(toks[0]!.raw).toBe('<Icon name="x"/>');
  });

  it('captures a self-closing component alone on a line as a block raw node', () => {
    const toks = rawTokens(md, '<Icon/>');
    expect(toks).toHaveLength(1);
    expect(toks[0]!.type).toBe('html_block');
    expect(toks[0]!.raw).toBe('<Icon/>');
  });

  it('captures a paired component block verbatim (multi-line)', () => {
    const src = '<Callout type="info">\nhello <Icon/>\n</Callout>';
    const toks = rawTokens(md, src);
    expect(toks).toHaveLength(1);
    expect(toks[0]!.type).toBe('html_block');
    expect(toks[0]!.raw).toBe(src);
  });

  it('captures nested same-name pairs via depth-counting', () => {
    const src = '<Foo>\n<Foo>x</Foo>\n</Foo>';
    const toks = rawTokens(md, src);
    expect(toks).toHaveLength(1);
    expect(toks[0]!.raw).toBe(src);
  });

  it('leaves allowlist names and lowercase HTML untouched', () => {
    expect(rawTokens(md, '<inline_mention type="d" slug="s"/>')).toEqual([]);
    expect(rawTokens(md, 'a <br> b')).toEqual([]);
    expect(rawTokens(md, '<strong>bold</strong>')).toEqual([]);
  });

  it('does not capture component tags inside fenced or inline code', () => {
    expect(rawTokens(md, '```\n<Callout>x</Callout>\n```')).toEqual([]);
    expect(rawTokens(md, 'see `<Icon/>` here')).toEqual([]);
  });
});

describe('raw node serializer — verbatim, no fence', () => {
  it('round-trips inline self-closing byte-perfect', () => {
    const md = makeMd();
    const raw = rawTokens(md, 'x <Icon a="1"/> y')[0]!.raw;
    const out = serializeInline(raw);
    expect(out).toBe('<Icon a="1"/>');
    expect(out).not.toContain('```');
  });

  it('round-trips paired block byte-perfect with no fence', () => {
    const md = makeMd();
    const src = '<Callout type="info">\nbody & "stuff" <Inner/>\n</Callout>';
    const raw = rawTokens(md, src)[0]!.raw;
    const out = serializeBlock(raw);
    expect(out).toBe(src);
    expect(out).not.toContain('```');
  });
});

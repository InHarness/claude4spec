import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { SingleElementNode } from './xmlNodes.js';

/**
 * 0.2.92 — a backtick inside a reference tag's attribute value is not an
 * inline-code delimiter in the editor either: the same masking gate as the
 * server-side `code-ranges.ts`, placed in front of markdown-it's `backticks`.
 */
function makeMd(): MarkdownIt {
  const md = new MarkdownIt({ html: true, breaks: false, linkify: false });
  (SingleElementNode as any).config.addStorage().markdown.parse.setup(md);
  return md;
}

function inlineTokens(md: MarkdownIt, src: string): Array<{ type: string; content: string }> {
  const out: Array<{ type: string; content: string }> = [];
  for (const block of md.parse(src, {})) {
    if (block.type === 'html_block') out.push({ type: block.type, content: block.content });
    for (const child of block.children ?? []) out.push({ type: child.type, content: child.content });
  }
  return out;
}

const chips = (tokens: Array<{ type: string; content: string }>) =>
  tokens.filter((t) => t.type.startsWith('html_') && t.content.includes('<single_element'));
const codes = (tokens: Array<{ type: string; content: string }>) => tokens.filter((t) => t.type === 'code_inline');

describe('xml rules vs backticks in attribute values', () => {
  it('[ac:m20-caption-backtick-chip] a caption backtick pair renders as a chip, not code', () => {
    const tokens = inlineTokens(makeMd(), 'See <single_element type="ac" slug="x" caption="run `make` first"/> now.');
    expect(chips(tokens)).toHaveLength(1);
    expect(codes(tokens)).toEqual([]);
  });

  it('[ac:m20-caption-backtick-chip] an earlier lone prose backtick does not pair into the caption', () => {
    const tokens = inlineTokens(makeMd(), 'Press ` then <single_element type="ac" slug="x" caption="the ` key"/> end.');
    expect(chips(tokens)).toHaveLength(1);
    expect(codes(tokens)).toEqual([]);
    expect(chips(tokens)[0]!.content).toContain('caption="the ` key"');
  });

  it('keeps real code spans around a backtick-caption tag', () => {
    const tokens = inlineTokens(
      makeMd(),
      'Use `npm ci` and <single_element type="ac" slug="x" caption="a ` b"/> then ``x ` y``.',
    );
    expect(chips(tokens)).toHaveLength(1);
    expect(codes(tokens).map((t) => t.content)).toEqual(['npm ci', 'x ` y']);
  });

  it('a block-level tag with a backtick caption stays a block chip', () => {
    const tokens = inlineTokens(makeMd(), 'Intro `a\n\n<single_element type="ac" slug="x" caption="b ` c"/>\n');
    expect(chips(tokens)).toHaveLength(1);
  });

  it('an escaped backtick before a backtick-caption tag does not shift the code spans', () => {
    const tokens = inlineTokens(
      makeMd(),
      'Type \\` then `cfg` and <single_element type="ac" slug="x" caption="a ` b"/> end.',
    );
    expect(chips(tokens)).toHaveLength(1);
    expect(codes(tokens).map((t) => t.content)).toEqual(['cfg']);
  });

  it('a backtick inside a link URL does not shift the code spans next to a backtick-caption tag', () => {
    const tokens = inlineTokens(
      makeMd(),
      'See [link](http://a/`b) and `code` <single_element type="ac" slug="x" caption="a ` b"/> end.',
    );
    expect(chips(tokens)).toHaveLength(1);
    expect(codes(tokens).map((t) => t.content)).toEqual(['code']);
  });

  it('leaves paragraphs without backtick attribute values to the stock rule (escapes intact)', () => {
    const tokens = inlineTokens(makeMd(), 'Escaped \\` tick and `code` here.');
    expect(codes(tokens).map((t) => t.content)).toEqual(['code']);
  });
});

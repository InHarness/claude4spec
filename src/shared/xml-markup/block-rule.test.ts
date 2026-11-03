import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { XML_BLOCK_RULE_NAME, registeredTagBlockRule } from './block-rule.js';
import { blockTokenizer, scanBlockStructure } from '../markdown-blocks.js';

/**
 * M51 — the registered-tag block rule is ONE rule, configured into the editor's
 * tokenizer (token `html_block`) and the server scanner's (token
 * `c4s_tag_block`); the two pipelines agree on which lines are a tag block.
 */
function editorLike(): MarkdownIt {
  const md = new MarkdownIt({ html: true, breaks: false, linkify: false });
  md.block.ruler.before(
    'html_block',
    XML_BLOCK_RULE_NAME,
    registeredTagBlockRule({ tokenType: 'html_block', content: (n) => `<${n}></${n}>` }),
  );
  return md;
}

function shape(md: MarkdownIt, src: string, tagToken: string): string[] {
  const tokens: Array<{ type: string; map: [number, number] | null }> = [];
  md.block.parse(src, md, {}, tokens as never);
  return tokens.map((t) => `${t.type === tagToken ? 'TAG' : t.type}@${t.map ? t.map.join('-') : ''}`);
}

describe('registeredTagBlockRule (shared by editor and server)', () => {
  const cases = [
    '<single_element type="dto" slug="x"/>',
    '<single_element type="dto" slug="x"/> trailing text',
    '<inline_mention type="dto" slug="x"/>',
    '<inline_mention type="dto" slug="x"/> and prose',
    'para\n<single_element type="dto" slug="x"/>',
    '- <element_list type="dto" slugs="a,b"/>\n- item',
    '> <tagged_list type="ac" tags="t"/>',
  ];

  it('the server tokenizer carries the same rule, under the same name, before html_block', () => {
    const names = (blockTokenizer().block.ruler as unknown as { __rules__: { name: string }[] }).__rules__.map(
      (r) => r.name,
    );
    expect(names.indexOf(XML_BLOCK_RULE_NAME)).toBeGreaterThanOrEqual(0);
    expect(names.indexOf(XML_BLOCK_RULE_NAME)).toBeLessThan(names.indexOf('html_block'));
  });

  it('yields the same block structure in the editor and the server configuration', () => {
    const editor = editorLike();
    const server = blockTokenizer();
    for (const src of cases) {
      expect(shape(server, src, 'c4s_tag_block'), src).toEqual(shape(editor, src, 'html_block'));
    }
  });

  it('a block-form tag followed by text on its line is no tag block: a paragraph on both sides', () => {
    const src = '<single_element type="dto" slug="x"/> trailing text';
    expect(shape(editorLike(), src, 'html_block')).toEqual(['paragraph_open@0-1', 'inline@0-1', 'paragraph_close@']);
    expect(shape(blockTokenizer(), src, 'c4s_tag_block')).toEqual([
      'paragraph_open@0-1',
      'inline@0-1',
      'paragraph_close@',
    ]);
    expect(scanBlockStructure(src).inlineBlocks).toEqual([[0, src.length]]);
  });

  it('a block-form tag alone on its line is one tag block; an inline-form one starts a paragraph', () => {
    expect(shape(editorLike(), '<single_element type="dto" slug="x"/>', 'html_block')).toEqual(['TAG@0-1']);
    expect(shape(blockTokenizer(), '<single_element type="dto" slug="x"/>', 'c4s_tag_block')).toEqual(['TAG@0-1']);
    expect(shape(blockTokenizer(), '<inline_mention type="dto" slug="x"/>', 'c4s_tag_block')).toEqual([
      'paragraph_open@0-1',
      'inline@0-1',
      'paragraph_close@',
    ]);
  });
});

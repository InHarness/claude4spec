/**
 * 2.1.1 — how a reference tag in a page file becomes an editor node.
 *
 * The four block reference nodes are recognised by the `xml_block` rule, the
 * inline mention by `xml_inline`. Both emit PAIRED html (`<x …></x>`), because
 * the DOM parser reads a custom `<x/>` as an open tag and would nest whatever
 * follows inside it — which is exactly the bug the "prose next to the node"
 * criterion rules out. Pinned at the markdown-it level: the editor parses the
 * html this produces, so the closing tag's position is what decides nesting.
 */

import { describe, expect, it } from 'vitest';
import { buildMarkdownIt } from '../markdown/buildMarkdownIt.js';

const md = () => buildMarkdownIt({ html: true });

describe('reference tags: from the file to the editor node', () => {
  it('[ac:m20-self-closing-tag-nie-pochlania-tresci] text after a self-closing tag stays prose beside the node', () => {
    const html = md().render('<single_element type="dto" slug="x"/> and the text after it');
    expect(html).toContain('<single_element type="dto" slug="x"></single_element> and the text after it');

    const inline = md().render('see <inline_mention type="dto" slug="x"/> then more prose');
    expect(inline).toContain('<inline_mention type="dto" slug="x"></inline_mention> then more prose');
  });

  it('[ac:m20-self-closing-tag-nie-pochlania-tresci] a paragraph after a block tag is its own paragraph, not the node body', () => {
    const html = md().render('<tagged_list_mixed tags="auth"/>\nTrailing paragraph.');
    expect(html).toMatch(/<tagged_list_mixed tags="auth"><\/tagged_list_mixed>\s*<p>Trailing paragraph\.<\/p>/);
  });

  it('[ac:m20-markdown-it-xml-rules] underscore-named self-closing tags become nodes, not literal text', () => {
    for (const src of [
      '<inline_mention type="dto" slug="x"/>',
      '<single_element type="dto" slug="x"/>',
      '<element_list type="dto" slugs="a,b"/>',
      '<tagged_list type="dto" tags="auth"/>',
      '<tagged_list_mixed tags="auth"/>',
    ]) {
      const html = md().render(src);
      expect(html, src).not.toContain('&lt;');
      expect(html, src).toMatch(/<([a-z_]+) [^>]*><\/\1>/);
    }
  });

  it('the four block reference nodes go through xml_block, the inline mention does not', () => {
    const m = md();
    const blockRules = (m.block.ruler as unknown as { __rules__: { name: string }[] }).__rules__.map((r) => r.name);
    expect(blockRules.indexOf('xml_block')).toBeGreaterThanOrEqual(0);
    expect(blockRules.indexOf('xml_block')).toBeLessThan(blockRules.indexOf('html_block'));

    const blockToken = (src: string) => m.parse(src, {}).map((t) => t.type);
    for (const tag of ['single_element', 'element_list', 'tagged_list', 'tagged_list_mixed']) {
      // A block tag alone on its line is ONE html_block, never wrapped in a paragraph.
      expect(blockToken(`<${tag} type="dto" slug="x"/>`), tag).toEqual(['html_block']);
    }
    // The inline mention alone on its line still sits inside a paragraph.
    expect(blockToken('<inline_mention type="dto" slug="x"/>')).toEqual([
      'paragraph_open',
      'inline',
      'paragraph_close',
    ]);
  });
});

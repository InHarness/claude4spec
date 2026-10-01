/**
 * M08 — a `<todo/>` round-trips through the page editor unchanged: the markdown-it
 * rule keeps the `comment` attribute (empty included) and the node's serializer
 * writes back the same tag, so opening and saving a page without edits leaves the
 * marker as it was.
 */

import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import '../registrations.js';
import { xmlTagNode } from './xmlNodes.js';

// M51 — the `todo` node is built from the tag registry, like every tag node.
const TodoNode = xmlTagNode('todo');

function serialize(comment: string): string {
  let out = '';
  (TodoNode as any).config
    .addStorage()
    .markdown.serialize({ write: (s: string) => void (out += s), closeBlock() {} }, { attrs: { comment } });
  return out;
}

function inlineHtml(src: string): string[] {
  const md = new MarkdownIt({ html: true });
  (TodoNode as any).config.addStorage().markdown.parse.setup(md);
  const out: string[] = [];
  for (const t of md.parse(src, {})) {
    for (const c of t.children ?? []) if (c.type === 'html_inline') out.push(c.content);
  }
  return out;
}

describe('TodoNode markdown round-trip', () => {
  it('[ac:ac-otwarcie-strony-ze-znacznikiem-w-edyt] writes an empty comment back as comment=""', () => {
    expect(serialize('')).toBe('<todo comment=""/>');
    expect(inlineHtml('a <todo comment=""/> b')[0]).toContain('comment=""');
  });

  it('round-trips a multi-line comment', () => {
    expect(serialize('line one\nline two')).toBe('<todo comment="line one\nline two"/>');
    expect(inlineHtml('a <todo comment="line one\nline two"/> b')[0]).toContain('line one\nline two');
  });

  it('writes a comment back with its quotes escaped', () => {
    expect(serialize('fix me')).toBe('<todo comment="fix me"/>');
    expect(serialize('say "hi"')).toBe('<todo comment="say &quot;hi&quot;"/>');
  });
});

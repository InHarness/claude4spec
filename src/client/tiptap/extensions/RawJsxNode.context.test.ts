/**
 * M20 `ctx4prof` rule 6 — gate 2 of the raw code node: a tag whose name is on
 * the dispatch allowlist but whose node is NOT mounted in this context passes
 * through verbatim instead of being dropped by ProseMirror on the first save.
 * Pins `ac-zapis-w-kontekscie-o-zawezonej-whitel` at the markdown-it level:
 * the tag becomes a raw token carrying the exact source bytes, and the raw
 * serializer writes those bytes back with no fence.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../registrations.js';
import { setupRawJsxRules, rawTagPredicate, RawJsxBlockNode, RawJsxInlineNode } from './RawJsxNode.js';
import { InlineMentionNode } from './xmlNodes.js';
import { unescapeRawAttr } from '../../../shared/raw-jsx-escape.js';
import { resolveContextSpec, FULL_ROOT_EDITOR_PROPS } from '../contextSpec.js';
import { registerExtensionReferenceType } from '../../../shared/reference-extensions.js';

const DESCRIPTION = resolveContextSpec('description', FULL_ROOT_EDITOR_PROPS, {
  extensionNames: () => [],
  slashCommandIds: () => [],
}).extensions;

/** The parser exactly as a `description` editor builds it: raw rules first, then the XML rules a mounted node installs. */
function descriptionMd(): MarkdownIt {
  const md = new MarkdownIt({ html: true, breaks: false, linkify: false });
  setupRawJsxRules(md, rawTagPredicate(DESCRIPTION));
  (InlineMentionNode as any).config.addStorage().markdown.parse.setup(md);
  return md;
}

function tokens(md: MarkdownIt, src: string): Array<{ type: string; content: string; raw?: string }> {
  const out: Array<{ type: string; content: string; raw?: string }> = [];
  const visit = (toks: any[]) => {
    for (const t of toks) {
      if (t.type === 'html_inline' || t.type === 'html_block') {
        const m = /data-c4s-raw="([^"]*)"/.exec(t.content);
        out.push({ type: t.type, content: t.content, raw: m ? unescapeRawAttr(m[1]!) : undefined });
      }
      if (t.children) visit(t.children);
    }
  };
  visit(md.parse(src, {}));
  return out;
}

function serialize(node: any, raw: string): string {
  let out = '';
  node.config.addStorage().markdown.serialize({ write: (s: string) => void (out += s), closeBlock() {} }, { attrs: { raw } });
  return out;
}

describe('raw node gate 2 — allowlisted tag, node not mounted in this context', () => {
  // `tests/setup.ts` clears the reference-type registry after every test;
  // `section_ref` reaches the dispatch allowlist through it (registrations.ts).
  beforeEach(() => registerExtensionReferenceType({ tag: 'section_ref', attrOrder: ['anchor'] }));

  it('routes <single_element/> in a description to the raw node, byte for byte', () => {
    const md = descriptionMd();
    const src = '<single_element type="ui-view" slug="login-form"/>';
    const toks = tokens(md, `Intro\n\n${src}\n\nOutro`);
    expect(toks).toHaveLength(1);
    expect(toks[0]!.type).toBe('html_block');
    expect(toks[0]!.raw).toBe(src);
    expect(serialize(RawJsxBlockNode, toks[0]!.raw!)).toBe(src);
  });

  it('routes a mid-prose <todo/> and <section_ref/> to the inline raw node', () => {
    const md = descriptionMd();
    const toks = tokens(md, 'see <todo comment="later"/> and <section_ref anchor="abcd1234"/> here');
    expect(toks.map((t) => t.raw)).toEqual(['<todo comment="later"/>', '<section_ref anchor="abcd1234"/>']);
    expect(toks.every((t) => t.type === 'html_inline')).toBe(true);
    expect(serialize(RawJsxInlineNode, toks[0]!.raw!)).toBe('<todo comment="later"/>');
  });

  it('still parses the mounted <inline_mention/> as its own node, not raw', () => {
    const md = descriptionMd();
    const toks = tokens(md, 'a <inline_mention type="dto" slug="user"/> b');
    expect(toks).toHaveLength(1);
    expect(toks[0]!.raw).toBeUndefined();
    expect(toks[0]!.content).toBe('<inline_mention type="dto" slug="user"></inline_mention>');
  });

  it('gate 1 is unchanged: component tags still pass through, lowercase HTML does not', () => {
    const md = descriptionMd();
    expect(tokens(md, 'x <Callout a="1"/> y')[0]!.raw).toBe('<Callout a="1"/>');
    expect(tokens(md, 'a <br> b').filter((t) => t.raw)).toEqual([]);
  });

  it('with mountedTags = null (read-only rendering) gate 2 is inert', () => {
    const md = new MarkdownIt({ html: true });
    setupRawJsxRules(md, rawTagPredicate(null));
    (InlineMentionNode as any).config.addStorage().markdown.parse.setup(md);
    expect(tokens(md, '<single_element type="dto" slug="x"/>')[0]!.raw).toBeUndefined();
  });

  it('the roundtrip fixture: every tag but inline_mention comes back verbatim in a description', () => {
    const md = descriptionMd();
    const fixture = readFileSync(
      fileURLToPath(new URL('../markdown/__fixtures__/roundtrip.md', import.meta.url)),
      'utf8',
    );
    const expectedRaw = [...fixture.matchAll(/<(single_element|element_list|tagged_list_mixed|tagged_list)[^>]*\/>/g)].map(
      (m) => m[0],
    );
    const toks = tokens(md, fixture);
    expect(toks.filter((t) => t.raw).map((t) => t.raw)).toEqual(expectedRaw);
    expect(toks.filter((t) => !t.raw)).toHaveLength(3); // the three inline mentions
  });
});

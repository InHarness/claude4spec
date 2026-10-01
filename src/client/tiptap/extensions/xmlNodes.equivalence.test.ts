/**
 * M51 — the guaranteed equivalence: the same text yields the same set of
 * recognised tags in the server parser and in the editor's rules, and a
 * markdown → editor → markdown round-trip leaves every registered tag as it was.
 */
import { describe, expect, it } from 'vitest';
import '../registrations.js';
import { parseXmlTags } from '../../../shared/xml-tags.js';
import { listXmlTags } from '../../../shared/xml-markup/registry.js';
import { buildMarkdownIt } from '../markdown/buildMarkdownIt.js';
import { readAttrs } from '../../../shared/xml-markup/pattern.js';
import { xmlTagNode } from './xmlNodes.js';

/** The tags the editor turns into nodes: paired `<name …></name>` html emitted by the XML rules. */
function editorTags(src: string): string[] {
  const names = listXmlTags().map((t) => t.name);
  const html = buildMarkdownIt({ html: true }).render(src);
  const re = new RegExp(`<(${names.join('|')})(?:\\s[^>]*)?></\\1>`, 'g');
  return [...html.matchAll(re)].map((m) => m[0].replace(/^<([a-z_]+)[\s\S]*$/, '$1'));
}

const serverTags = (src: string) => parseXmlTags(src).map((t) => t.kind);

const CORPUS: Record<string, string> = {
  'with space, no attrs': 'a <todo /> b',
  'no space, no attrs': 'a <todo/> b <section_ref/> c',
  'caption backtick pair': 'See <single_element type="ac" slug="x" caption="run `make` first"/> now.',
  'lone prose backtick': 'Press ` then <inline_mention type="dto" slug="y"/> end.',
  'tag in inline code': 'use `<inline_mention type="dto" slug="z"/>` like this <todo comment="live"/>',
  'tag in fence': '```\n<single_element type="dto" slug="f"/>\n```\n\n<element_list type="dto" slugs="a,b"/>',
  'tilde fence': '~~~\n<todo comment="in"/>\n~~~\n\n<todo comment="out"/>',
  'fence in a list item': '- item\n  ```\n  <todo comment="in"/>\n  ```\n- <todo comment="out"/>',
  'unclosed fence': '<todo comment="above"/>\n\n```\n<todo comment="below"/>\n',
  'multi-line HTML comment': '<!--\n<todo comment="commented"/>\n-->\n\n<todo comment="live"/>',
  'block tags on their own lines': '<tagged_list type="dto" tags="auth"/>\n\n<tagged_list_mixed tags="auth" filter="or"/>',
  'unknown JSX region': '<Callout>\n\n<inline_mention type="dto" slug="inside"/>\n\n</Callout>\n\n<section_ref anchor="abcd1234"/>',
  'name outside the registry': '<entity_ref type="dto" slug="x"/> <todo comment="y"/>',
};

describe('[ac:m51-parser-editor-equivalence] server parser ≡ editor rules', () => {
  for (const [label, src] of Object.entries(CORPUS)) {
    it(label, () => {
      expect(editorTags(src)).toEqual(serverTags(src));
    });
  }
});

/**
 * markdown → node attributes → markdown, through the editor's own pieces: the
 * XML rules' paired HTML, the attributes the node's `parseHTML` keeps (its
 * attribute order, absent = null), and the node's markdown serializer. The DOM
 * step itself is exercised in a real browser (e2e) — happy-dom rejects the
 * underscore element names tiptap-markdown builds a selector from.
 */
function roundTrip(markdown: string): string {
  const html = buildMarkdownIt({ html: true }).render(markdown);
  return markdown.replace(/<([a-z_]+)\s[^>]*?\/>/g, (whole, name: string) => {
    const paired = new RegExp(`<${name}((?:\\s[^>]*)?)></${name}>`).exec(html);
    if (!paired) return `MISSING(${whole})`;
    const node = xmlTagNode(name) as any;
    const keys: string[] = Object.keys(node.config.addAttributes());
    const fromDom = readAttrs(paired[1] ?? '');
    const attrs = Object.fromEntries(keys.map((k) => [k, k in fromDom ? decode(fromDom[k]!) : null]));
    let out = '';
    node.config
      .addStorage()
      .markdown.serialize({ write: (s: string) => void (out += s), closeBlock() {} }, { attrs });
    return out;
  });
}

function decode(v: string): string {
  return v.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

describe('[ac:m51-roundtrip-every-tag] markdown → editor → markdown leaves every registered tag unchanged', () => {
  const SAMPLES: Record<string, string> = {
    inline_mention: 'See <inline_mention type="dto" slug="user"/> here.',
    single_element: '<single_element type="dto" slug="user"/>',
    single_element_caption: '<single_element type="dto" slug="user" caption="The user"/>',
    element_list: '<element_list type="dto" slugs="a,b"/>',
    tagged_list: '<tagged_list type="dto" tags="auth"/>',
    tagged_list_filter: '<tagged_list type="dto" tags="auth,core" filter="or"/>',
    tagged_list_mixed: '<tagged_list_mixed tags="auth"/>',
    section_ref: 'See <section_ref anchor="abcd1234"/> here.',
    todo: 'Fix <todo comment="later"/> this.',
    todo_empty: 'Fix <todo comment=""/> this.',
  };
  for (const [label, md] of Object.entries(SAMPLES)) {
    it(label, () => {
      expect(roundTrip(md)).toBe(md);
    });
  }
});

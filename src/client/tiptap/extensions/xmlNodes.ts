import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { serializeXmlTag, type XmlTagKind } from '../../../shared/xml-tags.js';
import { InlineMentionView } from './views/InlineMentionView.js';
import { SingleElementView } from './views/SingleElementView.js';
import { ElementListView } from './views/ElementListView.js';
import { TaggedListView } from './views/TaggedListView.js';
import { TaggedListMixedView } from './views/TaggedListMixedView.js';
import { TodoView } from './views/TodoView.js';
import { DiagramNode } from './DiagramNode.js';

// markdown-it's default HTML rules only accept tag names matching
// [A-Za-z][A-Za-z0-9\-]* — which rejects our underscore-containing names
// (inline_mention, single_element, …). Moreover, HTML (unlike XHTML) does
// NOT treat `<foo/>` as self-closing for custom tags — it reads it as an
// open tag, causing everything after to nest inside. These plugins
// recognise our 5 XML tag kinds explicitly AND emit them as PAIRED tags
// (`<foo attr="…"></foo>`) so the DOM parser treats them as empty elements.

// `diagram` is a self-closing block reference (v0.1.64) — it joins the block
// tags here. The former content-bearing `<diagram>…DSL…</diagram>` rule
// (`xml_block_content`) was removed: the DSL body now lives in the diagram entity.
const BLOCK_TAGS_RE =
  /^<(single_element|element_list|tagged_list|tagged_list_mixed|todo|diagram)(\s[^>]*?)?\/?\s*>\s*$/;

const INLINE_TAG_RE =
  /^<(inline_mention|single_element|element_list|tagged_list|tagged_list_mixed|todo)(\s[^>]*?)?\/?\s*>/;

function toPairedHtml(kind: string | undefined, attrs: string | undefined): string {
  const cleanAttrs = (attrs ?? '').replace(/\/\s*$/, '').trimEnd();
  const attrPart = cleanAttrs ? ` ${cleanAttrs.trim()}` : '';
  return `<${kind ?? ''}${attrPart}></${kind ?? ''}>`;
}

function setupXmlMarkdownRules(md: any) {
  if (md.__claude4specXmlRules) return;
  md.__claude4specXmlRules = true;

  md.block.ruler.before(
    'html_block',
    'xml_block',
    (state: any, startLine: number, _endLine: number, silent: boolean) => {
      const pos = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const line = state.src.slice(pos, max);
      const match = BLOCK_TAGS_RE.exec(line);
      if (!match) return false;
      if (silent) return true;
      const token = state.push('html_block', '', 0);
      token.content = toPairedHtml(match[1], match[2]);
      token.map = [startLine, startLine + 1];
      state.line = startLine + 1;
      return true;
    }
  );

  md.inline.ruler.before('html_inline', 'xml_inline', (state: any, silent: boolean) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const tail = state.src.slice(state.pos);
    const match = INLINE_TAG_RE.exec(tail);
    if (!match) return false;
    if (!silent) {
      const token = state.push('html_inline', '', 0);
      token.content = toPairedHtml(match[1], match[2]);
    }
    state.pos += match[0].length;
    return true;
  });
}

function addMarkdownSerializer(kind: XmlTagKind, isBlock: boolean) {
  return function addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(serializeXmlTag(kind, node.attrs));
          if (isBlock) state.closeBlock(node);
        },
        parse: {
          setup: setupXmlMarkdownRules,
        },
      },
    };
  };
}

function pickAttrs(dom: HTMLElement, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = dom.getAttribute(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

export const InlineMentionNode = Node.create({
  name: 'inline_mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      type: { default: '' },
      slug: { default: '' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'inline_mention',
        getAttrs: (node) => pickAttrs(node as HTMLElement, ['type', 'slug']),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['inline_mention', mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(InlineMentionView);
  },
  addStorage: addMarkdownSerializer('inline_mention', false),
});

export const SingleElementNode = Node.create({
  name: 'single_element',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      type: { default: '' },
      slug: { default: '' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'single_element',
        getAttrs: (node) => pickAttrs(node as HTMLElement, ['type', 'slug']),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['single_element', mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SingleElementView);
  },
  addStorage: addMarkdownSerializer('single_element', true),
});

export const ElementListNode = Node.create({
  name: 'element_list',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      type: { default: '' },
      slugs: { default: '' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'element_list',
        getAttrs: (node) => pickAttrs(node as HTMLElement, ['type', 'slugs']),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['element_list', mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ElementListView);
  },
  addStorage: addMarkdownSerializer('element_list', true),
});

export const TaggedListNode = Node.create({
  name: 'tagged_list',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      type: { default: '' },
      tags: { default: '' },
      filter: { default: 'and' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'tagged_list',
        getAttrs: (node) => pickAttrs(node as HTMLElement, ['type', 'tags', 'filter']),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['tagged_list', mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TaggedListView);
  },
  addStorage: addMarkdownSerializer('tagged_list', true),
});

export const TaggedListMixedNode = Node.create({
  name: 'tagged_list_mixed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      tags: { default: '' },
      filter: { default: 'and' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'tagged_list_mixed',
        getAttrs: (node) => pickAttrs(node as HTMLElement, ['tags', 'filter']),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['tagged_list_mixed', mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TaggedListMixedView);
  },
  addStorage: addMarkdownSerializer('tagged_list_mixed', true),
});

export const TodoNode = Node.create({
  name: 'todo',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      comment: { default: '' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'todo',
        getAttrs: (node) => pickAttrs(node as HTMLElement, ['comment']),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['todo', mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TodoView);
  },
  addStorage: addMarkdownSerializer('todo', false),
});

export { setupXmlMarkdownRules };

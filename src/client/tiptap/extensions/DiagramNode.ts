import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { serializeXmlTag } from '../../../shared/xml-tags.js';
import { DiagramView } from './views/DiagramView.js';
import { setupXmlMarkdownRules } from './xmlNodes.js';

/**
 * v0.1.64 — `<diagram/>` is now a self-closing ENTITY REFERENCE (M19 extension
 * slot), not a content-bearing block. The mermaid `source` lives in the diagram
 * entity; the page only carries `slug` (which diagram) and `caption` (per-
 * reference prose). DiagramView fetches the source by slug and renders it.
 */
export const DiagramNode = Node.create({
  name: 'diagram',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      slug: { default: '' },
      caption: { default: '' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'diagram',
        getAttrs: (node) => {
          const el = node as HTMLElement;
          return {
            slug: el.getAttribute('slug') ?? '',
            caption: el.getAttribute('caption') ?? '',
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['diagram', mergeAttributes(HTMLAttributes, { class: 'c4s-diagram' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DiagramView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(serializeXmlTag('diagram', { slug: node.attrs.slug, caption: node.attrs.caption }));
          state.closeBlock(node);
        },
        parse: {
          setup: setupXmlMarkdownRules,
        },
      },
    };
  },
});

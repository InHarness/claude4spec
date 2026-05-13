import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { unescapeDiagramSource } from '../../../shared/diagram-source-escape.js';
import { DiagramView } from './views/DiagramView.js';

function escapeAttrValue(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export const DiagramNode = Node.create({
  name: 'diagram',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      format: { default: 'mermaid' },
      caption: { default: '' },
      source: { default: '' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'diagram',
        getAttrs: (node) => {
          const el = node as HTMLElement;
          return {
            format: el.getAttribute('format') ?? 'mermaid',
            caption: el.getAttribute('caption') ?? '',
            source: unescapeDiagramSource(el.getAttribute('source') ?? ''),
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
          const format = String(node.attrs.format || 'mermaid');
          const caption = String(node.attrs.caption ?? '');
          const source = String(node.attrs.source ?? '');
          const parts = [`format="${escapeAttrValue(format)}"`];
          if (caption) parts.push(`caption="${escapeAttrValue(caption)}"`);
          state.write(`<diagram ${parts.join(' ')}>\n${source}\n</diagram>`);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

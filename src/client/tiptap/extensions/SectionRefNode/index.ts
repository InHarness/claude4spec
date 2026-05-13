import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { serializeXmlTag } from '../../../../shared/xml-tags.js';
import { SectionRefView } from './SectionRefView.js';

const SECTION_REF_INLINE_RE = /^<section_ref(\s[^>]*?)?\/?\s*>/;

function attrsToPairedHtml(attrsStr: string | undefined): string {
  const cleaned = (attrsStr ?? '').replace(/\/\s*$/, '').trimEnd();
  return `<section_ref${cleaned ? ` ${cleaned.trim()}` : ''}></section_ref>`;
}

/**
 * Markdown-it inline rule for `<section_ref/>`. Lives next to the existing
 * `xml_inline` rule (M20) — additive, does not modify the regex matching the
 * 5 core types + `todo`. Spec: `m19_extension_slot` (`v3sgwjfv`) +
 * `m20-editor-tiptap.md` `tx1dyn4w` ("xml_inline rule M20 dispatch'uje 6.
 * nazwę tagu zarejestrowaną przez slot").
 */
export function setupSectionRefMarkdownRule(md: any): void {
  if (md.__claude4specSectionRefRule) return;
  md.__claude4specSectionRefRule = true;

  md.inline.ruler.before('html_inline', 'section_ref_inline', (state: any, silent: boolean) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const tail = state.src.slice(state.pos);
    const match = SECTION_REF_INLINE_RE.exec(tail);
    if (!match) return false;
    if (!silent) {
      const token = state.push('html_inline', '', 0);
      token.content = attrsToPairedHtml(match[1]);
    }
    state.pos += match[0].length;
    return true;
  });
}

export const SectionRefNode = Node.create({
  name: 'section_ref',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      anchor: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'section_ref',
        getAttrs: (node) => {
          const dom = node as HTMLElement;
          const anchor = dom.getAttribute('anchor') ?? '';
          return { anchor };
        },
      },
      {
        tag: 'span[data-section-ref]',
        getAttrs: (node) => {
          const dom = node as HTMLElement;
          const anchor = dom.getAttribute('data-anchor') ?? '';
          return { anchor };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-section-ref': 'true',
        'data-anchor': String(node.attrs.anchor ?? ''),
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SectionRefView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(serializeXmlTag('section_ref', node.attrs));
        },
        parse: {
          setup: setupSectionRefMarkdownRule,
        },
      },
    };
  },
});

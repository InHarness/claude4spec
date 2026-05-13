import { Node, mergeAttributes } from '@tiptap/core';
import { ANCHOR_PATTERN_SOURCE } from '../../../shared/anchor-pattern.js';

const ANCHOR_COMMENT_RE = new RegExp(`^${ANCHOR_PATTERN_SOURCE}\\s*$`);

export function setupAnchorMarkerRule(md: any): void {
  if (md.__claude4specAnchorRule) return;
  md.__claude4specAnchorRule = true;
  md.block.ruler.before('html_block', 'anchor_block', (state: any, startLine: number) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(pos, max);
    const m = ANCHOR_COMMENT_RE.exec(line);
    if (!m) return false;
    const token = state.push('html_block', '', 0);
    token.content = `<anchor_marker id="${m[1]}"></anchor_marker>`;
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  });
}

export const AnchorMarker = Node.create({
  name: 'anchor_marker',
  group: 'block',
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      id: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'anchor_marker' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'anchor_marker',
      mergeAttributes(HTMLAttributes, {
        style: 'display:none',
        'data-anchor': HTMLAttributes.id,
        id: `anchor-${HTMLAttributes.id}`,
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`<!-- anchor: ${node.attrs.id} -->`);
          state.closeBlock(node);
        },
        parse: {
          setup: setupAnchorMarkerRule,
        },
      },
    };
  },
});

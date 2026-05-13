import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { BlameBlock } from '../../../shared/entities.js';

export interface BlameDecorationOptions {
  getBlame: () => BlameBlock[];
  getBlameOn: () => boolean;
}

export const blamePluginKey = new PluginKey('blameDecoration');

export const BlameDecoration = Extension.create<BlameDecorationOptions>({
  name: 'blameDecoration',

  addOptions() {
    return {
      getBlame: () => [],
      getBlameOn: () => false,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: blamePluginKey,
        state: {
          init(_, state) {
            return buildDecorations(state.doc, options.getBlame(), options.getBlameOn());
          },
          apply(tr, old) {
            const refresh = tr.getMeta(blamePluginKey);
            if (refresh) {
              return buildDecorations(tr.doc, options.getBlame(), options.getBlameOn());
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

function buildDecorations(
  doc: import('@tiptap/pm/model').Node,
  blame: BlameBlock[],
  blameOn: boolean,
): DecorationSet {
  if (!blameOn || blame.length === 0) return DecorationSet.empty;

  const decs: Decoration[] = [];
  let blockIdx = 0;

  doc.descendants((node, pos) => {
    // Only top-level block nodes get a blame stripe (paragraph-level per spec).
    if (!node.isBlock) return true;
    if (node.type.name === 'doc') return true;

    // Skip invisible / marker nodes.
    if (node.type.name === 'anchor_marker') return false;

    const entry = blame[blockIdx];
    if (entry) {
      const colorIdx = ((entry.addedInVersion - 1) % 8) + 1;
      decs.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: `plan-blame plan-blame-v${colorIdx}`,
          'data-version': String(entry.addedInVersion),
        }),
      );
    }

    blockIdx += 1;
    // Don't descend into block children (keep it paragraph-level).
    return false;
  });

  return DecorationSet.create(doc, decs);
}

export function refreshBlame(view: import('@tiptap/pm/view').EditorView): void {
  view.dispatch(view.state.tr.setMeta(blamePluginKey, true));
}

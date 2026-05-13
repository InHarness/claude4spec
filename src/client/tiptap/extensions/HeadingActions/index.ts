import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createHeadingActionsWidget } from './widget.js';

export interface HeadingActionsOptions {
  pagePath: string | null;
}

const headingActionsKey = new PluginKey('headingActions');

export const HeadingActions = Extension.create<HeadingActionsOptions>({
  name: 'heading_actions',

  addOptions() {
    return { pagePath: null };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin({
        key: headingActionsKey,
        state: {
          init: (_, state) => buildDecorations(state.doc, opts.pagePath),
          apply: (tr, old) =>
            tr.docChanged ? buildDecorations(tr.doc, opts.pagePath) : old,
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

function buildDecorations(doc: PMNode, pagePath: string | null): DecorationSet {
  if (!pagePath) return DecorationSet.empty;
  const decs: Decoration[] = [];
  let lastAnchor: string | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name === 'anchor_marker') {
      const id = node.attrs.id as string | undefined;
      lastAnchor = id || null;
      return false;
    }
    if (node.type.name === 'heading') {
      const anchor = lastAnchor;
      decs.push(
        Decoration.widget(
          pos + 1,
          () => createHeadingActionsWidget({ anchor, pagePath }),
          { side: -1, key: `ha-${anchor ?? 'pending'}-${pos}` },
        ),
      );
      lastAnchor = null;
      return false;
    }
    return true;
  });
  return DecorationSet.create(doc, decs);
}

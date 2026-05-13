import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Annotation } from '../../../shared/entities.js';

export interface AnnotationHighlightOptions {
  getAnnotations: () => Annotation[];
  currentPage: string | null;
}

export const annotationPluginKey = new PluginKey('annotationHighlight');

export const AnnotationHighlight = Extension.create<AnnotationHighlightOptions>({
  name: 'annotationHighlight',

  addOptions() {
    return {
      getAnnotations: () => [],
      currentPage: null,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: annotationPluginKey,
        state: {
          init(_, state) {
            return buildDecorations(state.doc, options.getAnnotations(), options.currentPage);
          },
          apply(tr, old) {
            const refresh = tr.getMeta(annotationPluginKey);
            if (refresh) {
              return buildDecorations(tr.doc, options.getAnnotations(), options.currentPage);
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
  annotations: Annotation[],
  currentPage: string | null,
): DecorationSet {
  if (!currentPage) return DecorationSet.empty;
  const decs: Decoration[] = [];
  for (const a of annotations) {
    if (a.page !== currentPage || !a.range) continue;
    const from = Math.max(0, Math.min(doc.content.size, a.range.from));
    const to = Math.max(from, Math.min(doc.content.size, a.range.to));
    if (from === to) continue;
    decs.push(
      Decoration.inline(from, to, {
        class: 'anno-hl',
        title: a.comment || '(no comment)',
      }),
    );
  }
  return DecorationSet.create(doc, decs);
}

export function refreshAnnotations(view: import('@tiptap/pm/view').EditorView): void {
  view.dispatch(view.state.tr.setMeta(annotationPluginKey, true));
}

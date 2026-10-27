import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Annotation } from '../../../shared/entities.js';

/**
 * M53 (Agent Chat Shell, `9x9xm07q`) — the page-bound annotation highlight. A
 * ProseMirror decoration, never a Node or a Mark: it is ephemeral and never
 * reaches the page's markdown. Only the active page's annotations are drawn.
 */

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
            if (!refresh && !tr.docChanged) return old;
            const mapped = tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
            if (refresh) {
              return buildDecorations(tr.doc, options.getAnnotations(), options.currentPage, mapped);
            }
            return dropStale(mapped, tr.doc);
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

interface AnnotationDecorationSpec {
  annotationId: string;
  annotationText: string;
}

/**
 * Draws the highlights of the current page's annotations. The store keeps the
 * range as created, so an annotation that already has a highlight keeps its
 * MAPPED range (`previous`, followed through every edit since); only an
 * annotation without one is drawn from its stored range.
 */
function buildDecorations(
  doc: import('@tiptap/pm/model').Node,
  annotations: Annotation[],
  currentPage: string | null,
  previous: DecorationSet = DecorationSet.empty,
): DecorationSet {
  if (!currentPage) return DecorationSet.empty;
  const mappedRanges = new Map(
    previous.find().map((d) => [(d.spec as AnnotationDecorationSpec).annotationId, d] as const),
  );
  const decs: Decoration[] = [];
  for (const a of annotations) {
    if (a.page !== currentPage) continue;
    const range = mappedRanges.get(a.id) ?? a.range;
    if (!range) continue;
    const from = Math.max(0, Math.min(doc.content.size, range.from));
    const to = Math.max(from, Math.min(doc.content.size, range.to));
    if (from === to) continue;
    // The saved text is the source of truth, not the range: a range that no
    // longer covers that text is not highlighted (the annotation stays).
    if (!rangeCoversText(doc, from, to, a.text)) continue;
    decs.push(
      Decoration.inline(
        from,
        to,
        { class: 'anno-hl', title: a.comment || '(no comment)' },
        { annotationId: a.id, annotationText: a.text } satisfies AnnotationDecorationSpec,
      ),
    );
  }
  return DecorationSet.create(doc, decs);
}

/**
 * After an edit, a highlight whose mapped range no longer covers the text the
 * annotation saved is removed — the annotation itself stays in the store.
 */
function dropStale(set: DecorationSet, doc: import('@tiptap/pm/model').Node): DecorationSet {
  const stale = set
    .find()
    .filter((d) => !rangeCoversText(doc, d.from, d.to, (d.spec as AnnotationDecorationSpec).annotationText));
  return stale.length ? set.remove(stale) : set;
}

/**
 * The text an annotation saves for the selection `from…to`: plain text across
 * node boundaries (`textBetween`, blocks joined by a space), where an atom node —
 * an entity reference, any XML tag node — contributes what it RENDERS
 * (`renderLeaf`, e.g. its node view's text), never its markdown/XML source.
 */
export function annotationSelectionText(
  doc: import('@tiptap/pm/model').Node,
  from: number,
  to: number,
  renderLeaf: (pos: number, node: import('@tiptap/pm/model').Node) => string,
): string {
  const leafPositions: number[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isLeaf && !node.isText) leafPositions.push(pos);
  });
  let i = 0;
  // `textBetween` calls the leaf callback once per non-text leaf, in the same
  // document order `nodesBetween` visits them.
  return doc.textBetween(from, to, ' ', (node) => renderLeaf(leafPositions[i++] ?? -1, node));
}

const LEAF = '\u0000';
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether `from…to` still covers `text` (as `annotationSelectionText` saved it).
 * The text between atom nodes must match exactly; an atom matches whatever it
 * rendered when the annotation was made.
 */
export function rangeCoversText(doc: import('@tiptap/pm/model').Node, from: number, to: number, text: string): boolean {
  if (from >= to || to > doc.content.size) return false;
  const pattern = doc.textBetween(from, to, ' ', LEAF).split(LEAF).map(escapeRe).join('[\\s\\S]*?');
  return new RegExp(`^${pattern}$`).test(text);
}

export function refreshAnnotations(view: import('@tiptap/pm/view').EditorView): void {
  view.dispatch(view.state.tr.setMeta(annotationPluginKey, true));
}

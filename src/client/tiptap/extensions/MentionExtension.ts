import { Extension } from '@tiptap/core';
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import {
  getRegisteredMentionSources,
  type EditorContextId,
  type MentionSource,
} from '../registry.js';
import { MentionMenu, type MentionMenuHandle } from './MentionMenu.js';

export interface MentionExtensionOptions {
  /** Context in which this extension is mounted — filters mention sources. */
  contextId: EditorContextId;
}

/**
 * Generic mention framework: one Suggestion plugin per registered source trigger.
 * Sources are registered via `registerMentionSource` in registry.ts.
 * M14 is the first consumer via source `id: 'files'` (trigger `@`).
 */
export const MentionExtension = Extension.create<MentionExtensionOptions>({
  name: 'mention_extension',
  addOptions() {
    return { contextId: 'page' };
  },
  addProseMirrorPlugins() {
    const contextId = this.options.contextId;
    const sources = getRegisteredMentionSources(contextId);
    return sources.map((source) => buildSuggestionPlugin(this.editor, source));
  },
});

function buildSuggestionPlugin(editor: import('@tiptap/core').Editor, source: MentionSource<unknown>) {
  const suggestionOptions: Omit<SuggestionOptions<unknown>, 'editor'> = {
    char: source.trigger,
    allowSpaces: false,
    startOfLine: false,
    decorationTag: 'span',
    decorationClass: 'mention-suggestion',
    items: async ({ query }) => {
      if (source.minQueryLength && query.length < source.minQueryLength) return [];
      const result = await Promise.resolve(source.search(query, 20));
      return Array.isArray(result) ? result : [];
    },
    command: ({ editor, range, props }) => {
      editor.chain().focus().deleteRange(range).run();
      source.onSelect(props, editor);
    },
    render: () => {
      let reactRenderer: ReactRenderer<MentionMenuHandle> | null = null;
      let popup: HTMLDivElement | null = null;
      let lastRect: DOMRect | null = null;
      let resizeObs: ResizeObserver | null = null;

      const updatePos = (rect: DOMRect | null) => {
        if (!popup || !rect) return;
        lastRect = rect;
        const popupH = popup.offsetHeight || 0;
        const popupW = popup.offsetWidth || 0;
        const margin = 6;
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        // Flip above when there is not enough room below AND there is more room above.
        // Typical trigger in chat composer at the viewport bottom.
        const flipUp = popupH > 0 && spaceBelow < popupH + margin && spaceAbove > spaceBelow;
        const top = flipUp
          ? rect.top - margin - popupH + window.scrollY
          : rect.bottom + margin + window.scrollY;
        let left = rect.left + window.scrollX;
        if (popupW > 0 && left + popupW > window.innerWidth - 8) {
          left = Math.max(8, window.innerWidth - popupW - 8);
        }
        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;
      };

      return {
        onStart(props: SuggestionProps<unknown>) {
          reactRenderer = new ReactRenderer(MentionMenu, {
            editor: props.editor,
            props: { ...props, source },
          });
          popup = document.createElement('div');
          popup.style.position = 'absolute';
          popup.style.zIndex = '1000';
          popup.style.top = '-9999px';
          popup.appendChild(reactRenderer.element);
          document.body.appendChild(popup);
          updatePos(props.clientRect?.() ?? null);
          // Popup content renders async; re-measure once height is known so the flip-up
          // decision uses real dimensions (otherwise first paint always lands below).
          resizeObs = new ResizeObserver(() => updatePos(lastRect));
          resizeObs.observe(popup);
        },
        onUpdate(props: SuggestionProps<unknown>) {
          reactRenderer?.updateProps({ ...props, source });
          updatePos(props.clientRect?.() ?? null);
        },
        onKeyDown(props) {
          if (props.event.key === 'Escape') {
            resizeObs?.disconnect();
            resizeObs = null;
            popup?.remove();
            popup = null;
            return true;
          }
          return reactRenderer?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit() {
          resizeObs?.disconnect();
          resizeObs = null;
          popup?.remove();
          popup = null;
          lastRect = null;
          reactRenderer?.destroy();
          reactRenderer = null;
        },
      };
    },
  };

  return Suggestion<unknown>({
    pluginKey: new PluginKey(`c4s-suggestion-mention-${source.id}`),
    editor,
    ...suggestionOptions,
  });
}

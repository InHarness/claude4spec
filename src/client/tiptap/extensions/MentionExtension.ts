import { Extension } from '@tiptap/core';
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import { setSuggestionPopupOpen } from '../suggestionState.js';
import { positionSuggestionPopup } from '../suggestionPopupPosition.js';
import {
  getRegisteredMentionSources,
  type EditorContextId,
  type MentionSearchContext,
  type MentionSource,
  type RootEditorProps,
} from '../registry.js';
import { MentionMenu, type MentionMenuHandle } from './MentionMenu.js';

export interface MentionExtensionOptions {
  /** Context in which this extension is mounted — filters mention sources. */
  contextId: EditorContextId;
  /** The page root's props — the derived `page` spec depends on them. */
  rootProps?: RootEditorProps;
  /** 2.1.8: the root of the page being edited; null outside a page. Handed to every source's `search`. */
  rootId?: string | null;
}

/**
 * Generic mention framework: one Suggestion plugin per registered source trigger.
 * Sources are registered via `registerMentionSource` in registry.ts.
 * M14 is the first consumer via source `id: 'files'` (trigger `@`).
 */
export const MentionExtension = Extension.create<MentionExtensionOptions>({
  name: 'mention_extension',
  addOptions() {
    return { contextId: 'page', rootProps: undefined, rootId: null };
  },
  addProseMirrorPlugins() {
    const contextId = this.options.contextId;
    const sources = getRegisteredMentionSources(contextId, this.options.rootProps);
    const searchCtx: MentionSearchContext = { rootId: this.options.rootId ?? null };
    return sources.map((source) => buildSuggestionPlugin(this.editor, source, searchCtx));
  },
});

/**
 * The suggestion `items` of one source: honours `minQueryLength`, asks for 20
 * items and hands the source the editor's search context (2.1.8: its root).
 */
export async function mentionItems(
  source: MentionSource<unknown>,
  query: string,
  ctx: MentionSearchContext,
): Promise<unknown[]> {
  if (source.minQueryLength && query.length < source.minQueryLength) return [];
  const result = await Promise.resolve(source.search(query, 20, ctx));
  return Array.isArray(result) ? result : [];
}

function buildSuggestionPlugin(
  editor: import('@tiptap/core').Editor,
  source: MentionSource<unknown>,
  ctx: MentionSearchContext,
) {
  const popupKey = `mention:${source.id}`;
  const suggestionOptions: Omit<SuggestionOptions<unknown>, 'editor'> = {
    char: source.trigger,
    allowSpaces: false,
    startOfLine: false,
    decorationTag: 'span',
    decorationClass: 'mention-suggestion',
    items: ({ query }) => mentionItems(source, query, ctx),
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
        positionSuggestionPopup(popup, rect);
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
          setSuggestionPopupOpen(props.editor.view, popupKey, props.items.length > 0);
        },
        onUpdate(props: SuggestionProps<unknown>) {
          reactRenderer?.updateProps({ ...props, source });
          updatePos(props.clientRect?.() ?? null);
          setSuggestionPopupOpen(props.editor.view, popupKey, popup !== null && props.items.length > 0);
        },
        onKeyDown(props) {
          if (props.event.key === 'Escape') {
            resizeObs?.disconnect();
            resizeObs = null;
            popup?.remove();
            popup = null;
            setSuggestionPopupOpen(props.view, popupKey, false);
            return true;
          }
          return reactRenderer?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit(props: SuggestionProps<unknown>) {
          resizeObs?.disconnect();
          resizeObs = null;
          popup?.remove();
          popup = null;
          lastRect = null;
          reactRenderer?.destroy();
          reactRenderer = null;
          setSuggestionPopupOpen(props.editor.view, popupKey, false);
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

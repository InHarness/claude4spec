import { Extension, type Editor } from '@tiptap/core';
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import { setSuggestionPopupOpen } from '../suggestionState.js';
import { SlashMenu, type SlashMenuHandle, type SlashCommand } from './SlashMenu.js';
import type { EditorContextId, RootEditorProps } from '../registry.js';
import { createSlashSession, type SlashPaletteItem, type SlashSession } from '../slashPalette.js';

export interface SlashCommandsOptions {
  onInvoke: (editor: Editor, command: SlashCommand) => void;
  /**
   * L8: the palette lists only the commands whitelisted for THIS context
   * (`EditorContextSpec.slashCommands`). Before 0.2.85 it listed every
   * registered command regardless of where the editor was mounted — an entity
   * description offered `/todo` and `/section` although neither node was in
   * its schema, so picking one inserted nothing.
   */
  contextId: EditorContextId;
  /** The page root's props — the derived `page` spec depends on them. */
  rootProps?: RootEditorProps;
}

/** The `/` suggestion plugin's key — lets a host read whether the palette is open. */
export const SLASH_SUGGESTION_KEY = new PluginKey('c4s-suggestion-slash');
/** Its popup's key in `suggestionState` — what `isSuggestionActive` reads. */
const SLASH_POPUP = 'slash';

/**
 * The slash framework — the `SlashDispatcher` of M20's contribution sheet
 * (trigger `/`, direct registration): aggregates the fixed commands and the
 * command sources (2.1.9) admitted by the context, through `slashPalette.ts`.
 */
export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: 'slash_commands',
  addOptions() {
    return {
      onInvoke: () => {},
      contextId: 'page',
      rootProps: undefined,
    };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    // 2.1.9 (M20 `lxdrxdm2`): one session per opening of the popover — command
    // sources are pulled at the opening, never cached across openings.
    let session: SlashSession | null = null;
    const currentSession = () => (session ??= createSlashSession(options.contextId, options.rootProps));
    // Re-lists the open popover from the current session — set by `render()`.
    let refreshPopover: ((editor: Editor) => Promise<void>) | null = null;
    const command: SuggestionOptions<SlashPaletteItem>['command'] = ({ editor, range, props }) => {
      const picked = props.source;
      if (picked?.item.narrowTo) {
        // Narrow the SAME popover: it stays open, the typed prefix is
        // cleared (the range keeps only its `/`), and the next listing of
        // this session shows the target source's items alone.
        currentSession().narrowTo(picked.item.narrowTo);
        const typedPrefix = editor.state.doc.textBetween(range.from + 1, range.to);
        editor.chain().focus().insertContentAt(range, '/').run();
        // `@tiptap/suggestion` re-fetches `items` only when the query or
        // the range moved. Picked with an empty query (`/`, then arrows or
        // a click), `/` → `/` changes neither, so the popover would keep
        // the full listing: re-list it here. With a typed prefix the query
        // changes (`skills` → ``) and the plugin re-lists on its own.
        if (typedPrefix === '') void refreshPopover?.(editor);
        return;
      }
      editor.chain().focus().deleteRange(range).run();
      if (picked) {
        // Control passes to the source: it inserts at the caret or opens a window.
        void Promise.resolve(picked.source.onSelect(picked.item, editor)).catch((err) =>
          console.warn(`[editor] command source "${picked.source.id}" failed to handle its item`, err),
        );
        return;
      }
      if (props.command) options.onInvoke(editor, props.command);
    };
    return [
      Suggestion<SlashPaletteItem>({
        pluginKey: SLASH_SUGGESTION_KEY,
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => currentSession().items(query),
        command,
        render: () => {
          let reactRenderer: ReactRenderer<SlashMenuHandle> | null = null;
          let popup: HTMLDivElement | null = null;
          let lastProps: SuggestionProps<SlashPaletteItem> | null = null;
          refreshPopover = async (editor: Editor) => {
            const state = SLASH_SUGGESTION_KEY.getState(editor.state) as
              | { active: boolean; range: { from: number; to: number }; query: string; text: string }
              | undefined;
            if (!state?.active || !reactRenderer || !lastProps) return;
            const { range, query, text } = state;
            const items = await currentSession().items(query);
            // The popover closed or moved on while the listing was read.
            if (!reactRenderer || !lastProps) return;
            const now = SLASH_SUGGESTION_KEY.getState(editor.state) as typeof state;
            if (!now?.active || now.range.from !== range.from || now.query !== query) return;
            lastProps = {
              ...lastProps,
              range,
              query,
              text,
              items,
              command: (item: SlashPaletteItem) => command({ editor, range, props: item }),
            };
            reactRenderer.updateProps(lastProps);
            setSuggestionPopupOpen(editor.view, SLASH_POPUP, popup !== null && items.length > 0);
          };
          const updatePos = (rect: DOMRect | null) => {
            if (!popup || !rect) return;
            const top = rect.bottom + 6 + window.scrollY;
            const left = rect.left + window.scrollX;
            popup.style.top = `${top}px`;
            popup.style.left = `${left}px`;
          };
          return {
            onStart(props: SuggestionProps<SlashPaletteItem>) {
              lastProps = props;
              reactRenderer = new ReactRenderer(SlashMenu, {
                editor: props.editor,
                props,
              });
              popup = document.createElement('div');
              popup.style.position = 'absolute';
              popup.style.zIndex = '1000';
              popup.appendChild(reactRenderer.element);
              document.body.appendChild(popup);
              updatePos(props.clientRect?.() ?? null);
              setSuggestionPopupOpen(props.editor.view, SLASH_POPUP, props.items.length > 0);
            },
            onUpdate(props: SuggestionProps<SlashPaletteItem>) {
              lastProps = props;
              reactRenderer?.updateProps(props);
              updatePos(props.clientRect?.() ?? null);
              setSuggestionPopupOpen(props.editor.view, SLASH_POPUP, popup !== null && props.items.length > 0);
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                popup?.remove();
                popup = null;
                setSuggestionPopupOpen(props.view, SLASH_POPUP, false);
                return true;
              }
              return reactRenderer?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit(props: SuggestionProps<SlashPaletteItem>) {
              session = null;
              lastProps = null;
              popup?.remove();
              popup = null;
              reactRenderer?.destroy();
              reactRenderer = null;
              setSuggestionPopupOpen(props.editor.view, SLASH_POPUP, false);
            },
          };
        },
      }),
    ];
  },
});

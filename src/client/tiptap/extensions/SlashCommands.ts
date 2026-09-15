import { Extension, type Editor } from '@tiptap/core';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import { setSuggestionPopupOpen } from '../suggestionState.js';
import { SlashMenu, type SlashMenuHandle, type SlashCommand } from './SlashMenu.js';
import {
  getRegisteredSlashCommandsForContext,
  type EditorContextId,
  type RootEditorProps,
} from '../registry.js';

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
    return [
      Suggestion<SlashCommand>({
        pluginKey: SLASH_SUGGESTION_KEY,
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => filterCommands(query, options.contextId, options.rootProps),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          options.onInvoke(editor, props);
        },
        render: () => {
          let reactRenderer: ReactRenderer<SlashMenuHandle> | null = null;
          let popup: HTMLDivElement | null = null;
          const updatePos = (rect: DOMRect | null) => {
            if (!popup || !rect) return;
            const top = rect.bottom + 6 + window.scrollY;
            const left = rect.left + window.scrollX;
            popup.style.top = `${top}px`;
            popup.style.left = `${left}px`;
          };
          return {
            onStart(props: SuggestionProps<SlashCommand>) {
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
            onUpdate(props: SuggestionProps<SlashCommand>) {
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
            onExit(props: SuggestionProps<SlashCommand>) {
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

function filterCommands(
  query: string,
  contextId: EditorContextId,
  rootProps?: RootEditorProps,
): SlashCommand[] {
  const commands = getRegisteredSlashCommandsForContext(contextId, rootProps);
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => c.id.includes(q) || c.label.toLowerCase().includes(q));
}

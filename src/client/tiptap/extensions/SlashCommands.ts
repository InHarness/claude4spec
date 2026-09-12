import { Extension, type Editor } from '@tiptap/core';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import { SlashMenu, type SlashMenuHandle, type SlashCommand } from './SlashMenu.js';
import { getRegisteredSlashCommandsForContext, type EditorContextId } from '../registry.js';

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
}

export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: 'slash_commands',
  addOptions() {
    return {
      onInvoke: () => {},
      contextId: 'page',
    };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<SlashCommand>({
        pluginKey: new PluginKey('c4s-suggestion-slash'),
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => filterCommands(query, options.contextId),
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
            },
            onUpdate(props: SuggestionProps<SlashCommand>) {
              reactRenderer?.updateProps(props);
              updatePos(props.clientRect?.() ?? null);
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                popup?.remove();
                popup = null;
                return true;
              }
              return reactRenderer?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit() {
              popup?.remove();
              popup = null;
              reactRenderer?.destroy();
              reactRenderer = null;
            },
          };
        },
      }),
    ];
  },
});

function filterCommands(query: string, contextId: EditorContextId): SlashCommand[] {
  const commands = getRegisteredSlashCommandsForContext(contextId);
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => c.id.includes(q) || c.label.toLowerCase().includes(q));
}

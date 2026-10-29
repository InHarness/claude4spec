import type { Editor } from '@tiptap/core';
import type { SlashCommand } from './extensions/SlashMenu.js';
import { openPopover } from '../ui/events.js';

/**
 * 2.1.63 — no `qc`: its one reader was the host's `/diagram` arm, gone with the
 * type (the prebuilt `diagrams` envelope dispatches through
 * `c4s:plugin-command` like every other plugin command).
 */
export interface SlashInvokeDeps {
  /**
   * Page path the editor is currently mounted on.
   *
   * 0.2.80 — no longer read here. It is forwarded on the `c4s:plugin-command`
   * event so a plugin's create form can default from context; `c4s-plugin-ac`
   * uses it for exactly what this comment used to describe, from its own side.
   */
  currentPath?: string | null;
}

/** M33: window event a delivered plugin frontend listens for to run its popover. */
export const PLUGIN_COMMAND_EVENT = 'c4s:plugin-command';

export async function invokeSlash(
  editor: Editor,
  command: SlashCommand,
  deps: SlashInvokeDeps,
): Promise<void> {
  // M33: a declarative plugin command is executed by the editor
  // framework dispatching its popover kind — NOT by plugin logic here. The
  // plugin's frontend (delivered separately) listens for this event.
  if (command.pluginPopoverKind) {
    window.dispatchEvent(
      new CustomEvent(PLUGIN_COMMAND_EVENT, {
        detail: {
          popoverKind: command.pluginPopoverKind,
          commandId: command.id,
          editor,
          // 0.2.2 — the caret, in viewport coordinates. Every host-side slash
          // popover anchors to `coordsAt(editor)`; a plugin popover could not,
          // because the event carried no position, so it had to fall back to a
          // fixed spot at the top of the viewport — jumping away from the text
          // the user was writing. The plugin owns whether to use it.
          coords: tryCoordsAt(editor),
          /**
           * 0.2.80 — the page the command was typed on, as a HINT.
           *
           * The host arm this replaces for `/ac` pre-filled the new criterion's
           * tags from the path (`modules/m17-…` → `m17`; a page named for a
           * registered type → `entity-<type>`), and the envelope cannot compute
           * it: nothing else on this event says where the caret is. Sending it
           * is additive and useful to any envelope whose create form wants to
           * default from context — the plugin owns whether to use it, and a
           * plugin that ignores it loses nothing.
           */
          currentPath: deps.currentPath ?? null,
        },
      }),
    );
    return;
  }
  switch (command.id) {
    case 'mention':
      await runMention(editor);
      return;
    case 'element':
      await runElement(editor);
      return;
    case 'list':
      await runList(editor);
      return;
    case 'tagged':
      await runTagged(editor);
      return;
    case 'tagged-mixed':
      await runTaggedMixed(editor);
      return;
    case 'todo':
      await runTodo(editor);
      return;
    case 'section':
      await runSection(editor);
      return;
  }
}

/**
 * A host popover takes focus away from the editor; a cancelled one (Escape,
 * click-outside) must hand it back. Otherwise the caret is simply gone — and
 * an editor that saves on blur (the L8 `description` context) never sees the
 * blur that would persist what was typed before the `/`.
 */
async function popoverFromEditor<T>(editor: Editor, open: () => Promise<T>): Promise<T> {
  const result = await open();
  if (!result && !editor.isDestroyed) editor.commands.focus();
  return result;
}

async function runSection(editor: Editor): Promise<void> {
  const result = await popoverFromEditor(editor, () =>
    openPopover('xml-tag', { ...coordsAt(editor), name: 'section_ref', mode: 'create', attrs: { anchor: null } }),
  );
  if (!result) return;
  editor
    .chain()
    .focus()
    .insertContent({ type: 'section_ref', attrs: { anchor: result.anchor ?? '' } })
    .insertContent(' ')
    .run();
}

/**
 * The caret position, or nothing.
 *
 * The host's own popovers are opened from a live editor and read `coordsAt`
 * directly. The plugin dispatch cannot: it hands the position across a window
 * event to code it does not control, as an anchoring HINT, and an editor with no
 * mounted view (destroyed, or a caller that never had one) must not turn a
 * working slash command into a thrown error. The plugin falls back to its own
 * default position when this is absent.
 */
function tryCoordsAt(editor: Editor): { x: number; y: number } | undefined {
  try {
    return editor.view ? coordsAt(editor) : undefined;
  } catch {
    return undefined;
  }
}

function coordsAt(editor: Editor): { x: number; y: number } {
  const view = editor.view;
  const coords = view.coordsAtPos(view.state.selection.from);
  return { x: coords.left, y: coords.bottom + 6 };
}

async function runTodo(editor: Editor): Promise<void> {
  const result = await popoverFromEditor(editor, () =>
    openPopover('xml-tag', { ...coordsAt(editor), name: 'todo', mode: 'create', attrs: { comment: '' } }),
  );
  if (!result) return;
  editor
    .chain()
    .focus()
    .insertContent({ type: 'todo', attrs: { comment: result.comment ?? '' } })
    .run();
}

async function runMention(editor: Editor): Promise<void> {
  const result = await popoverFromEditor(editor, () => openPopover('mention', { ...coordsAt(editor) }));
  if (!result) return;
  editor
    .chain()
    .focus()
    .insertContent({ type: 'inline_mention', attrs: { type: result.type, slug: result.slug } })
    .run();
}

async function runElement(editor: Editor): Promise<void> {
  const result = await popoverFromEditor(editor, () => openPopover('element', { ...coordsAt(editor) }));
  if (!result) return;
  editor
    .chain()
    .focus()
    .insertContent({ type: 'single_element', attrs: { type: result.type, slug: result.slug } })
    .run();
}

async function runList(editor: Editor): Promise<void> {
  const result = await popoverFromEditor(editor, () => openPopover('list', { ...coordsAt(editor) }));
  if (!result) return;
  editor
    .chain()
    .focus()
    .insertContent({
      type: 'element_list',
      attrs: { type: result.type, slugs: result.slugs.join(',') },
    })
    .run();
}

async function runTagged(editor: Editor): Promise<void> {
  const result = await popoverFromEditor(editor, () => openPopover('tagged', { ...coordsAt(editor) }));
  if (!result) return;
  editor
    .chain()
    .focus()
    .insertContent({
      type: 'tagged_list',
      attrs: {
        type: result.type,
        tags: result.tags.join(','),
        filter: result.filter,
      },
    })
    .run();
}

async function runTaggedMixed(editor: Editor): Promise<void> {
  const result = await popoverFromEditor(editor, () => openPopover('tagged-mixed', { ...coordsAt(editor) }));
  if (!result) return;
  editor
    .chain()
    .focus()
    .insertContent({
      type: 'tagged_list_mixed',
      attrs: {
        tags: result.tags.join(','),
        filter: result.filter,
      },
    })
    .run();
}



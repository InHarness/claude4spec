import type { Editor } from '@tiptap/core';
import type { QueryClient } from '@tanstack/react-query';
import type { SlashCommand } from './extensions/SlashMenu.js';
import { acsApi } from '../entities/ac/api.js';
import { diagramsApi } from '../entities/diagram/api.js';
import type { DiagramFormat } from '../../shared/entities.js';
import { dispatchTodoPopover } from '../components/TodoPopover.js';
import { openPopover, toast } from '../ui/events.js';

export interface SlashInvokeDeps {
  qc: QueryClient;
  /** Page path the editor is currently mounted on. Used to pre-fill AC tags. */
  currentPath?: string | null;
}

function detectAcDefaultTags(currentPath: string | null | undefined): string[] {
  if (!currentPath) return [];
  const m = currentPath.match(/^modules\/(m\d{2})-/i);
  if (m) return [m[1]!.toLowerCase()];
  const e = currentPath.match(/^entities\/([a-z0-9-]+)\.md$/i);
  if (e) return [`entity-${e[1]}`];
  return [];
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
    case 'ac':
      await runCreateAc(editor, deps);
      return;
    case 'todo':
      runTodo(editor);
      return;
    case 'diagram':
      await runDiagram(editor, deps);
      return;
    case 'section':
      await runSection(editor);
      return;
  }
}

async function runSection(editor: Editor): Promise<void> {
  const result = await openPopover('section', coordsAt(editor), {});
  if (!result) return;
  if ('__action' in result) return;
  editor
    .chain()
    .focus()
    .insertContent({ type: 'section_ref', attrs: { anchor: result.anchor } })
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

async function runDiagram(editor: Editor, deps: SlashInvokeDeps): Promise<void> {
  const coords = coordsAt(editor);
  const result = await openPopover('diagram', coords, { mode: 'create' });
  if (!result) return;
  if ('__action' in result) return;
  try {
    // v0.1.64: the DSL `source` is the truth — create the diagram entity, then
    // insert a reference to it on the page. `caption` seeds the slug (slugify)
    // but is NOT persisted on the entity.
    //
    // 0.2.15: that reference is now the GENERIC block tag, not a `<diagram/>`
    // of its own — `<single_element type="diagram" slug caption/>`. `caption` is
    // omitted entirely when empty, so the tag never round-trips a `caption=""`.
    const diagram = await diagramsApi.create({
      source: result.source,
      format: result.format as DiagramFormat,
      caption: result.caption,
    });
    deps.qc.invalidateQueries({ queryKey: ['diagrams'] });
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'single_element',
        attrs: {
          type: 'diagram',
          slug: diagram.slug,
          caption: result.caption ? result.caption : null,
        },
      })
      .run();
  } catch (err) {
    toast.error((err as Error).message);
  }
}

function runTodo(editor: Editor): void {
  const { x, y } = coordsAt(editor);
  dispatchTodoPopover({
    x,
    y,
    mode: 'create',
    onSubmit: (comment) => {
      editor
        .chain()
        .focus()
        .insertContent({ type: 'todo', attrs: { comment } })
        .run();
    },
  });
}

async function runMention(editor: Editor): Promise<void> {
  const result = await openPopover('mention', coordsAt(editor), {});
  if (!result) return;
  editor
    .chain()
    .focus()
    .insertContent({ type: 'inline_mention', attrs: { type: result.type, slug: result.slug } })
    .run();
}

async function runElement(editor: Editor): Promise<void> {
  const result = await openPopover('element', coordsAt(editor), {});
  if (!result) return;
  editor
    .chain()
    .focus()
    .insertContent({ type: 'single_element', attrs: { type: result.type, slug: result.slug } })
    .run();
}

async function runList(editor: Editor): Promise<void> {
  const result = await openPopover('list', coordsAt(editor), {});
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
  const result = await openPopover('tagged', coordsAt(editor), {});
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
  const result = await openPopover('tagged-mixed', coordsAt(editor), {});
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

async function runCreateAc(editor: Editor, deps: SlashInvokeDeps): Promise<void> {
  const defaultTags = detectAcDefaultTags(deps.currentPath ?? null);
  const result = await openPopover('create-ac', coordsAt(editor), { defaultTags });
  if (!result) return;
  try {
    const ac = await acsApi.create(result);
    deps.qc.invalidateQueries({ queryKey: ['acs'] });
    editor
      .chain()
      .focus()
      .insertContent({ type: 'single_element', attrs: { type: 'ac', slug: ac.slug } })
      .run();
    toast.success('AC created');
  } catch (err) {
    toast.error((err as Error).message);
  }
}


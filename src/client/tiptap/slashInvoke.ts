import type { Editor } from '@tiptap/core';
import type { QueryClient } from '@tanstack/react-query';
import type { SlashCommand } from './extensions/SlashMenu.js';
import { dtosApi, endpointsApi } from '../lib/api.js';
import { acsApi } from '../entities/ac/api.js';
import { dispatchNewDatabaseTable } from '../components/NewDatabaseTablePopover.js';
import { dispatchNewUiView } from '../components/NewUiViewPopover.js';
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

export async function invokeSlash(
  editor: Editor,
  command: SlashCommand,
  deps: SlashInvokeDeps,
): Promise<void> {
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
    case 'endpoint':
      await runCreateEndpoint(editor, deps);
      return;
    case 'dto':
      await runCreateDto(editor, deps);
      return;
    case 'ac':
      await runCreateAc(editor, deps);
      return;
    case 'database-table':
      runCreateDatabaseTable(editor, deps);
      return;
    case 'ui-view':
      runCreateUiView(editor, deps);
      return;
    case 'todo':
      runTodo(editor);
      return;
    case 'diagram':
      await runDiagram(editor);
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

function coordsAt(editor: Editor): { x: number; y: number } {
  const view = editor.view;
  const coords = view.coordsAtPos(view.state.selection.from);
  return { x: coords.left, y: coords.bottom + 6 };
}

async function runDiagram(editor: Editor): Promise<void> {
  const coords = coordsAt(editor);
  const result = await openPopover('diagram', coords, { mode: 'create' });
  if (!result) return;
  if ('__action' in result) return;
  editor
    .chain()
    .focus()
    .insertContent({
      type: 'diagram',
      attrs: { format: result.format, caption: result.caption, source: result.source },
    })
    .run();
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

async function runCreateEndpoint(editor: Editor, deps: SlashInvokeDeps): Promise<void> {
  const result = await openPopover('create-endpoint', coordsAt(editor), {});
  if (!result) return;
  try {
    const ep = await endpointsApi.create(result);
    deps.qc.invalidateQueries({ queryKey: ['endpoints'] });
    editor
      .chain()
      .focus()
      .insertContent({ type: 'single_element', attrs: { type: 'endpoint', slug: ep.slug } })
      .run();
    toast.success(`Endpoint ${ep.method} ${ep.path} created`);
  } catch (err) {
    toast.error((err as Error).message);
  }
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

async function runCreateDto(editor: Editor, deps: SlashInvokeDeps): Promise<void> {
  const result = await openPopover('create-dto', coordsAt(editor), {});
  if (!result) return;
  try {
    const dto = await dtosApi.create(result);
    deps.qc.invalidateQueries({ queryKey: ['dtos'] });
    editor
      .chain()
      .focus()
      .insertContent({ type: 'single_element', attrs: { type: 'dto', slug: dto.slug } })
      .run();
    toast.success(`DTO ${dto.name} created`);
  } catch (err) {
    toast.error((err as Error).message);
  }
}

function runCreateDatabaseTable(editor: Editor, deps: SlashInvokeDeps): void {
  const { x, y } = coordsAt(editor);
  dispatchNewDatabaseTable({
    x,
    y,
    onCreated: (slug) => {
      deps.qc.invalidateQueries({ queryKey: ['database-tables'] });
      editor
        .chain()
        .focus()
        .insertContent({ type: 'single_element', attrs: { type: 'database-table', slug } })
        .run();
      toast.success(`Table ${slug} created`);
    },
  });
}

function runCreateUiView(editor: Editor, deps: SlashInvokeDeps): void {
  const { x, y } = coordsAt(editor);
  dispatchNewUiView({
    x,
    y,
    onCreated: (slug) => {
      deps.qc.invalidateQueries({ queryKey: ['ui-views'] });
      editor
        .chain()
        .focus()
        .insertContent({ type: 'single_element', attrs: { type: 'ui-view', slug } })
        .run();
      toast.success(`UI view ${slug} created`);
    },
  });
}

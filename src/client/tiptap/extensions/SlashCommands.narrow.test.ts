// @vitest-environment happy-dom
/**
 * 2.1.9 — narrowing the slash popover through the `SlashCommands` extension
 * itself (not the pure `SlashSession`): an item carrying `narrowTo` keeps the
 * popover open and re-lists it with the target source's items alone.
 *
 * `@tiptap/suggestion` re-fetches `items` only when the query or the range
 * moved. Picked with an empty query (`/`, then arrows or a click), `/` → `/`
 * changes neither — the extension must re-list the popover itself.
 *
 * `ReactRenderer` is replaced by a recorder: the test reads the props the
 * popover was last rendered with, as `SlashMenu` would.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const renderers: Array<{ props: { items: Array<{ key: string }>; command: (item: unknown) => void } }> = [];

vi.mock('@tiptap/react', () => ({
  ReactRenderer: class {
    element = document.createElement('div');
    ref = null;
    props: unknown;
    constructor(_component: unknown, options: { props: unknown }) {
      this.props = options.props;
      renderers.push(this as never);
    }
    updateProps(props: Record<string, unknown>) {
      this.props = { ...(this.props as Record<string, unknown>), ...props };
    }
    destroy() {}
  },
}));

import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import '../registrations.js';
import { registerSlashCommandSource, unregisterSlashCommandSource } from '../registry.js';
import { SlashCommands } from './SlashCommands.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function settle() {
  for (let i = 0; i < 5; i++) await flush();
}

const onSelect = vi.fn();
let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  renderers.length = 0;
  onSelect.mockReset();
  unregisterSlashCommandSource('narrow-probe:entry');
  unregisterSlashCommandSource('narrow-probe:target');
});

function setup() {
  registerSlashCommandSource({
    id: 'narrow-probe:entry',
    context: 'page',
    list: () => [{ id: 'go', label: 'Narrow probe', description: 'narrow', hint: '/narrowprobe', narrowTo: 'narrow-probe:target' }],
    onSelect,
  });
  registerSlashCommandSource({
    id: 'narrow-probe:target',
    context: 'page',
    list: () => [
      { id: 'a', label: 'Alpha', description: 'a', hint: '/probe-alpha' },
      { id: 'b', label: 'Beta', description: 'b', hint: '/probe-beta' },
    ],
    onSelect,
  });
  editor = new Editor({
    extensions: [Document, Paragraph, Text, SlashCommands.configure({ contextId: 'page' })],
    content: '<p></p>',
  });
  return editor;
}

const keys = () => renderers.at(-1)!.props.items.map((i) => i.key);

describe('SlashCommands — narrowing the open popover', () => {
  it('picking a narrowing item with an empty query re-lists the popover with the target source alone', async () => {
    const ed = setup();
    ed.commands.insertContent('/');
    await settle();

    expect(renderers).toHaveLength(1);
    const full = keys();
    expect(full).toContain('source:narrow-probe:entry:go');
    expect(full).toContain('command:section');

    const entry = renderers[0]!.props.items.find((i) => i.key === 'source:narrow-probe:entry:go')!;
    renderers[0]!.props.command(entry);
    await settle();

    // Same popover (no second renderer), narrowed listing, `/` kept, no onSelect.
    expect(renderers).toHaveLength(1);
    expect(keys()).toEqual(['source:narrow-probe:target:a', 'source:narrow-probe:target:b']);
    expect(ed.state.doc.textContent).toBe('/');
    expect(onSelect).not.toHaveBeenCalled();

    // The re-listed popover's picks still work: a target item reaches its source.
    const alpha = renderers[0]!.props.items[0]!;
    renderers[0]!.props.command(alpha);
    await settle();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ id: 'a' });
    expect(ed.state.doc.textContent).toBe('');
  });

  it('picking a narrowing item after a typed prefix narrows too (the query change re-lists)', async () => {
    const ed = setup();
    ed.commands.insertContent('/narrowp');
    await settle();
    expect(keys()).toEqual(['source:narrow-probe:entry:go']);

    renderers.at(-1)!.props.command(renderers.at(-1)!.props.items[0]);
    await settle();

    expect(ed.state.doc.textContent).toBe('/');
    expect(keys()).toEqual(['source:narrow-probe:target:a', 'source:narrow-probe:target:b']);
  });
});

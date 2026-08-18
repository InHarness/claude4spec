import { describe, expect, it, vi, beforeAll } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { QueryClient } from '@tanstack/react-query';
import { registerPluginCommands } from './pluginCommands.js';
import { getRegisteredSlashCommands } from './registry.js';
import { invokeSlash, PLUGIN_COMMAND_EVENT } from './slashInvoke.js';

// Minimal window/CustomEvent stubs — the suite runs under the `node` env (no
// jsdom dependency). invokeSlash's plugin branch only dispatches a window event.
const dispatched: Array<{ type: string; detail: unknown }> = [];
beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.CustomEvent === 'undefined') {
    g.CustomEvent = class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
  }
  g.window = { dispatchEvent: (e: { type: string; detail: unknown }) => dispatched.push(e) };
});

describe('M33 — plugin command routing', () => {
  it('registers a declarative command as a slash entry carrying pluginPopoverKind', () => {
    registerPluginCommands([{ name: 'foo-insert', trigger: 'foo', label: 'Insert Foo', popoverKind: 'foo' }]);
    const cmd = getRegisteredSlashCommands().find((c) => c.id === 'foo-insert');
    expect(cmd).toBeDefined();
    expect(cmd?.hint).toBe('/foo');
    expect(cmd?.pluginPopoverKind).toBe('foo');
  });

  it('skips a malformed command (missing popoverKind) with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPluginCommands([{ name: 'bad', trigger: 'bad', label: 'Bad', popoverKind: '' }]);
    expect(getRegisteredSlashCommands().some((c) => c.id === 'bad')).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('re-registering a shrunken list drops the departed plugin\'s command (replace, not merge)', () => {
    // 0.2.29 — the editor extension registry is the ONE consumer that does not
    // read by pull: `registerEditorExtension` upserts and never removes. So when
    // the host unregisters a plugin, every server-side consumer notices, but a
    // departed package's trigger would sit in the slash menu until a full page
    // reload. `registerPluginCommands` therefore replaces the whole
    // `plugin-cmd:` namespace rather than merging into it.
    registerPluginCommands([
      { name: 'stays', trigger: 'stays', label: 'Stays', popoverKind: 'stays' },
      { name: 'departs', trigger: 'departs', label: 'Departs', popoverKind: 'departs' },
    ]);
    expect(getRegisteredSlashCommands().map((c) => c.id)).toEqual(
      expect.arrayContaining(['stays', 'departs']),
    );

    // The plugin contributing `departs` left the pool; /_meta/plugin-commands
    // now returns only the survivor.
    registerPluginCommands([{ name: 'stays', trigger: 'stays', label: 'Stays', popoverKind: 'stays' }]);
    const ids = getRegisteredSlashCommands().map((c) => c.id);
    expect(ids).toContain('stays');
    expect(ids).not.toContain('departs');
    // Exactly one entry — a replace must not leave a duplicate behind either.
    expect(ids.filter((id) => id === 'stays')).toHaveLength(1);
  });

  it('invokeSlash dispatches a generic popover event for a plugin command (no id switch)', async () => {
    dispatched.length = 0;
    await invokeSlash(
      {} as Editor,
      { id: 'foo-insert', label: 'Insert Foo', description: 'Insert Foo', hint: '/foo', pluginPopoverKind: 'foo' },
      { qc: {} as QueryClient },
    );
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe(PLUGIN_COMMAND_EVENT);
    expect(dispatched[0]?.detail).toMatchObject({ popoverKind: 'foo', commandId: 'foo-insert' });
  });
});

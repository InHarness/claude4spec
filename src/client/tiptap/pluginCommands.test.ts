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

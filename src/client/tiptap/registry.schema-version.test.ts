/**
 * 0.2.85 — the L8 ordering invariant (`m33l8wir` / `m20l11sc`).
 *
 * Tiptap freezes its schema at create, so an editor mounted before a plugin's
 * node types arrive keeps a schema without them. The registry publishes a
 * schema version that editors follow (`useEditorSchema.ts`); this pins WHEN it
 * moves: on a registration that carries an `extension` (added, replaced or
 * removed), and never on one that carries only a slash command or a mention
 * source — those are read live and must not cost a rebuild.
 */

import { describe, expect, it } from 'vitest';
import {
  getEditorSchemaVersion,
  registerEditorExtension,
  subscribeEditorSchema,
  unregisterEditorExtensionsByPrefix,
} from './registry.js';

const fakeExtension = { name: 'fake' } as unknown as NonNullable<
  Parameters<typeof registerEditorExtension>[0]['extension']
>;

describe('editor registry schema version', () => {
  it('bumps when a schema-bearing registration lands, is replaced, or leaves', () => {
    const before = getEditorSchemaVersion();
    registerEditorExtension({ name: 'test-schema:a', extension: fakeExtension });
    expect(getEditorSchemaVersion()).toBe(before + 1);
    // Re-registering under the same name replaces the entry — still a schema change.
    registerEditorExtension({ name: 'test-schema:a', extension: fakeExtension });
    expect(getEditorSchemaVersion()).toBe(before + 2);
    unregisterEditorExtensionsByPrefix('test-schema:');
    expect(getEditorSchemaVersion()).toBe(before + 3);
  });

  it('does not bump for a slash-command-only registration', () => {
    const before = getEditorSchemaVersion();
    registerEditorExtension({
      name: 'test-cmd:only',
      slashCommand: { id: 'only', label: '/only', description: 'x', hint: '' },
    });
    expect(getEditorSchemaVersion()).toBe(before);
    unregisterEditorExtensionsByPrefix('test-cmd:');
    expect(getEditorSchemaVersion()).toBe(before);
  });

  it('notifies subscribers once per settled batch of registrations', async () => {
    let calls = 0;
    const unsubscribe = subscribeEditorSchema(() => {
      calls += 1;
    });
    registerEditorExtension({ name: 'test-batch:a', extension: fakeExtension });
    registerEditorExtension({ name: 'test-batch:b', extension: fakeExtension });
    registerEditorExtension({ name: 'test-batch:c', extension: fakeExtension });
    expect(calls).toBe(0); // coalesced into a microtask
    await Promise.resolve();
    expect(calls).toBe(1);
    unregisterEditorExtensionsByPrefix('test-batch:');
    await Promise.resolve();
    expect(calls).toBe(2);
    unsubscribe();
    registerEditorExtension({ name: 'test-batch:d', extension: fakeExtension });
    await Promise.resolve();
    expect(calls).toBe(2);
    unregisterEditorExtensionsByPrefix('test-batch:');
  });
});
